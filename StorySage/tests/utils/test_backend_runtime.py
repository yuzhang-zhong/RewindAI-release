"""Regression checks for optional services and runtime configuration."""

import importlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


def test_voice_import_does_not_initialize_aws_client(monkeypatch):
    import boto3

    client_factory = Mock(side_effect=AssertionError("Unexpected AWS access"))
    monkeypatch.setattr(boto3, "client", client_factory)
    import api.routers.voice as voice

    importlib.reload(voice)
    client_factory.assert_not_called()
    assert voice.s3_client is None


def test_s3_client_is_initialized_only_on_demand(monkeypatch):
    from api.routers import voice

    client = object()
    factory = Mock(return_value=client)
    monkeypatch.setattr(voice.boto3, "client", factory)
    monkeypatch.setattr(voice, "s3_client", None)
    assert voice._get_s3_client() is client
    assert voice._get_s3_client() is client
    factory.assert_called_once()
    assert factory.call_args.args == ("s3",)


@pytest.mark.asyncio
async def test_configured_voice_storage_uses_lazy_s3_client(monkeypatch):
    from api.routers import voice

    storage = Mock()
    storage.generate_presigned_url.return_value = "https://example.invalid/smoke-audio"
    factory = Mock(return_value=storage)
    monkeypatch.setattr(voice.boto3, "client", factory)
    monkeypatch.setattr(voice, "s3_client", None)
    monkeypatch.setattr(voice, "BUCKET_NAME", "smoke-test-bucket")
    speech = Mock(return_value=SimpleNamespace(content=b"synthetic-audio"))
    monkeypatch.setattr(
        voice.openai, "OpenAI",
        Mock(return_value=SimpleNamespace(audio=SimpleNamespace(speech=SimpleNamespace(create=speech)))),
    )

    result = await voice.text_to_speech(
        {"text": "Synthetic smoke text"}, http_request=None, current_user="smoke-user"
    )

    assert result == {"audioUrl": "https://example.invalid/smoke-audio"}
    factory.assert_called_once()
    storage.put_object.assert_called_once()
    assert storage.put_object.call_args.kwargs["Body"] == b"synthetic-audio"
    assert storage.put_object.call_args.kwargs["Bucket"] == "smoke-test-bucket"
    storage.generate_presigned_url.assert_called_once()


def test_logger_uses_current_logs_directory(monkeypatch, tmp_path):
    from utils.logger.session_logger import SessionLogger

    monkeypatch.setattr(SessionLogger, "_current_logger", None)
    monkeypatch.setenv("LOGS_DIR", str(tmp_path / "first"))
    assert SessionLogger("first-user").log_dir == tmp_path / "first" / "first-user"
    monkeypatch.setenv("LOGS_DIR", str(tmp_path / "second"))
    assert SessionLogger("second-user").log_dir == tmp_path / "second" / "second-user"
    monkeypatch.delenv("LOGS_DIR")
    assert SessionLogger("default-user").log_dir == Path("logs") / "default-user"


def test_password_hashing_and_auth_roundtrip(tmp_path):
    """Exercise real hashing and HTTP auth, without inherited DB connections."""
    import os
    import subprocess
    import sys
    import textwrap

    env = {
        **os.environ,
        "PYTHONPATH": str(Path(__file__).resolve().parents[2] / "src"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "DATABASE_URL": f"sqlite:///{tmp_path / 'auth.db'}",
        "POSTGRES_URL": "",
        "DATA_DIR": str(tmp_path / "data"),
        "LOGS_DIR": str(tmp_path / "logs"),
        "STORYSAGE_JWT_SECRET": "synthetic-auth-regression-signing-key-not-real",
    }
    script = textwrap.dedent("""
        import socket

        def no_network(*args, **kwargs):
            raise AssertionError("Authentication regression must stay offline")

        socket.socket.connect = no_network
        socket.socket.connect_ex = no_network
        socket.create_connection = no_network

        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.core.auth import get_user_from_token
        from api.routers import auth, register
        from database.database import SessionLocal, engine
        from database.models import Base, DBUser, DBUserProfile

        password = "Synthetic-review-pass-42!"
        hashed = register.pwd_context.hash(password)
        assert register.pwd_context.verify(password, hashed)
        assert auth.pwd_context.verify(password, hashed)
        assert not auth.pwd_context.verify("wrong-synthetic-password", hashed)

        Base.metadata.create_all(bind=engine)
        app = FastAPI()
        app.include_router(register.router)
        app.include_router(auth.router)
        payload = {
            "user_id": "synthetic-auth-regression",
            "password": password,
            "study_group": "blank",
        }
        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.post("/user/register", json=payload)
                assert response.status_code == 200, response.status_code
                registered = response.json()
                assert registered["study_group"] == "blank"
                assert get_user_from_token(registered["access_token"]) == payload["user_id"]
                assert client.post("/user/register", json=payload).status_code == 400

                response = client.post("/user/login", json=payload)
                assert response.status_code == 200, response.status_code
                assert get_user_from_token(response.json()["access_token"]) == payload["user_id"]
                wrong = {**payload, "password": "wrong-synthetic-password"}
                assert client.post("/user/login", json=wrong).status_code == 403

            with SessionLocal() as db:
                user = db.query(DBUser).filter(DBUser.user_id == payload["user_id"]).one()
                assert user.password_hash != password
                assert auth.pwd_context.verify(password, user.password_hash)
                profile = db.query(DBUserProfile).filter(
                    DBUserProfile.user_id == payload["user_id"]
                ).one()
                assert profile.study_group == "blank"
        finally:
            engine.dispose()
    """)
    result = subprocess.run(
        [sys.executable, "-c", script],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr

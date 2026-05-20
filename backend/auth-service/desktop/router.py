"""Desktop API router: bootstrap, identity, assistant CRUD.

These endpoints are only registered when LAZYMIND_MODE=desktop.
They require no authentication — the Electron proxy validates origin and injects identity.
"""
import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.security import create_access_token
from models import User
from repositories import RoleRepository, UserRepository
from services.auth_service import auth_service

from .schemas import AssistantCreateIn, AssistantOut, AssistantUpdateIn, IdentityOut

router = APIRouter(prefix='/desktop', tags=['Desktop'])

logger = logging.getLogger('auth-service.desktop')

_DEFAULT_ASSISTANT_USERNAME = 'astronomer'
_DEFAULT_ASSISTANT_DISPLAY = '天文学家 🪐'
_DESKTOP_SOURCE = 'desktop'


def _get_user_role_id(db: Session) -> uuid.UUID:
    role = RoleRepository.get_by_name(db, 'user')
    if not role:
        raise HTTPException(status_code=500, detail='Role "user" not found. Run bootstrap first.')
    return role.id


def _user_to_assistant(user: User, default_id: str | None = None) -> AssistantOut:
    return AssistantOut(
        id=str(user.id),
        username=user.username,
        display_name=user.display_name or user.username,
        is_default=(str(user.id) == default_id) if default_id else False,
    )


@router.post('/bootstrap')
def desktop_bootstrap():
    """Idempotent bootstrap: ensure roles, permissions, and default assistant exist."""
    from bootstrap import bootstrap as run_bootstrap

    with SessionLocal() as db:
        run_bootstrap(db)

        existing = db.query(User).filter_by(username=_DEFAULT_ASSISTANT_USERNAME, source=_DESKTOP_SOURCE).first()
        if not existing:
            role_id = _get_user_role_id(db)
            UserRepository.create(
                db,
                username=_DEFAULT_ASSISTANT_USERNAME,
                password_hash=auth_service.hash_password('desktop-local-only'),
                role_id=role_id,
                display_name=_DEFAULT_ASSISTANT_DISPLAY,
                source=_DESKTOP_SOURCE,
            )
            logger.info('Created default desktop assistant: %s', _DEFAULT_ASSISTANT_DISPLAY)

    return {'status': 'ok'}


@router.get('/identity')
def desktop_identity() -> IdentityOut:
    """Return the default assistant identity with a long-lived JWT."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(username=_DEFAULT_ASSISTANT_USERNAME, source=_DESKTOP_SOURCE).first()
        if not user:
            raise HTTPException(status_code=404, detail='Default assistant not found. Call /desktop/bootstrap first.')

        token = create_access_token(
            subject=str(user.id),
            role='user',
            username=user.username,
        )

        return IdentityOut(
            user_id=str(user.id),
            username=user.username,
            display_name=user.display_name or user.username,
            token=token,
        )


@router.get('/assistants')
def list_assistants() -> list[AssistantOut]:
    """List all desktop assistants."""
    with SessionLocal() as db:
        users = db.query(User).filter_by(source=_DESKTOP_SOURCE).order_by(User.created_at).all()
        default = db.query(User).filter_by(
            username=_DEFAULT_ASSISTANT_USERNAME, source=_DESKTOP_SOURCE
        ).first()
        default_id = str(default.id) if default else None
        return [_user_to_assistant(u, default_id) for u in users]


@router.post('/assistants')
def create_assistant(body: AssistantCreateIn) -> AssistantOut:
    """Create a new desktop assistant (maps to a User record)."""
    with SessionLocal() as db:
        existing = db.query(User).filter_by(username=body.username, source=_DESKTOP_SOURCE).first()
        if existing:
            raise HTTPException(status_code=409, detail=f'Assistant with username "{body.username}" already exists.')

        role_id = _get_user_role_id(db)
        user = UserRepository.create(
            db,
            username=body.username,
            password_hash=auth_service.hash_password('desktop-local-only'),
            role_id=role_id,
            display_name=body.display_name,
            source=_DESKTOP_SOURCE,
        )
        return _user_to_assistant(user)


@router.patch('/assistants/{assistant_id}')
def update_assistant(assistant_id: str, body: AssistantUpdateIn) -> AssistantOut:
    """Update a desktop assistant's display name."""
    with SessionLocal() as db:
        try:
            uid = uuid.UUID(assistant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid assistant ID.')

        user = db.query(User).filter_by(id=uid, source=_DESKTOP_SOURCE).first()
        if not user:
            raise HTTPException(status_code=404, detail='Assistant not found.')

        if body.display_name is not None:
            user.display_name = body.display_name
            db.commit()
            db.refresh(user)

        return _user_to_assistant(user)


@router.delete('/assistants/{assistant_id}')
def delete_assistant(assistant_id: str):
    """Delete a desktop assistant. Cannot delete the default assistant."""
    with SessionLocal() as db:
        try:
            uid = uuid.UUID(assistant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid assistant ID.')

        user = db.query(User).filter_by(id=uid, source=_DESKTOP_SOURCE).first()
        if not user:
            raise HTTPException(status_code=404, detail='Assistant not found.')

        if user.username == _DEFAULT_ASSISTANT_USERNAME:
            raise HTTPException(status_code=403, detail='Cannot delete the default assistant.')

        db.delete(user)
        db.commit()

    return {'status': 'ok'}

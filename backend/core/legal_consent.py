"""Versioned, account-scoped legal consent policy."""

from datetime import datetime, timezone


LEGAL_BUNDLE_VERSION = "2026-11-21"


def requires_legal_consent(user: object) -> bool:
    required_version = getattr(user, "legal_consent_required_version", None)
    if required_version is None:
        # Legacy accounts are exempt until deliberately marked for a bundle.
        return False
    return not (
        getattr(user, "legal_consent_version", None) == required_version
        and getattr(user, "privacy_acknowledged_at", None) is not None
        and getattr(user, "terms_accepted_at", None) is not None
    )


def accept_legal_bundle(user: object, version: str) -> bool:
    """Set both acknowledgements together; return False on an idempotent retry."""
    if version != LEGAL_BUNDLE_VERSION or version != getattr(user, "legal_consent_required_version", None):
        raise ValueError("This legal bundle version is not required for this account.")
    if not requires_legal_consent(user):
        return False
    accepted_at = datetime.now(timezone.utc)
    user.privacy_acknowledged_at = accepted_at
    user.terms_accepted_at = accepted_at
    user.legal_consent_version = version
    return True

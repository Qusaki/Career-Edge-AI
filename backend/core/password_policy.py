import unicodedata


MIN_PASSWORD_CHARACTERS = 8
MAX_PASSWORD_UTF8_BYTES = 72


def validate_new_password(password: str) -> str:
    """Validate a new password without changing the value that will be hashed."""
    if not isinstance(password, str):
        raise ValueError("Password must be a string.")
    if not password.strip():
        raise ValueError("Password cannot contain only spaces.")
    if len(password) < MIN_PASSWORD_CHARACTERS:
        raise ValueError("Password must be at least 8 characters.")
    try:
        byte_length = len(password.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise ValueError("Password contains an invalid character.") from error
    if byte_length > MAX_PASSWORD_UTF8_BYTES:
        raise ValueError("Password is too long. Use at most 72 UTF-8 bytes.")
    categories = {unicodedata.category(character) for character in password}
    if "Lu" not in categories:
        raise ValueError("Password must include at least one uppercase letter.")
    if "Ll" not in categories:
        raise ValueError("Password must include at least one lowercase letter.")
    if "Nd" not in categories:
        raise ValueError("Password must include at least one number.")
    if not any(category.startswith(("P", "S")) for category in categories):
        raise ValueError("Password must include at least one special character.")
    return password

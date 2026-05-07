const fs = require('fs');
let content = fs.readFileSync('backend/database.py', 'utf-8');

if (!content.includes("check_same_thread")) {
  content = content.replace(
    "if SQLALCHEMY_DATABASE_URL and \"sslmode\" in SQLALCHEMY_DATABASE_URL:\n    # This helps some drivers that might not pick it up from the URL string alone\n    engine_kwargs[\"connect_args\"] = {\"sslmode\": \"require\"}",
    "if SQLALCHEMY_DATABASE_URL and \"sslmode\" in SQLALCHEMY_DATABASE_URL:\n    engine_kwargs[\"connect_args\"] = {\"sslmode\": \"require\"}\nelif SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith(\"sqlite\"):\n    engine_kwargs[\"connect_args\"] = {\"check_same_thread\": False}"
  );
  fs.writeFileSync('backend/database.py', content);
  console.log("Patched database.py for SQLite compatibility.");
}

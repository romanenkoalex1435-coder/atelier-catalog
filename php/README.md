PHP 8.2 backend
==============

`router.php` serves only allowed frontend assets in development and routes API requests using the original REQUEST_URI. In Apache, the parent entrypoint must require `php/router.php`; route `/api/*`, `/p/*`, `/sitemap.xml`, `/data/products.json`, and `/images/*` to that entrypoint. Deny all direct access to `/php/`, private/source directories, dotfiles and backups. PHP should run with display_errors=Off, log_errors=On, and post_max_size at least 36M.

Configuration comes from environment variables or `php/config.local.php` (an array; use `settings.example.php`). An optional REWEAR_CONFIG_FILE environment variable points to a private configuration file. REWEAR_DATA_DIR must be an absolute path outside REWEAR_DOCROOT; this is enforced. It holds data/products.json, images/, images/preview/ and private/. REWEAR_SITE_URL is a fixed HTTPS origin, never inferred from Host or forwarded headers. Default: https://rewearvintage.shop.

REMOTE_ADDR is authoritative. If the hosting provider has a verified trusted nginx proxy, list its exact addresses in REWEAR_TRUSTED_PROXIES, comma-separated. Only then does the backend inspect X-Forwarded-For, from right to left, to find the closest untrusted address. Do not set this based solely on a request header.

Provision a new account using `php php/init-account.php`, sending a JSON object through stdin: login, password, optional allowedIps array, mustChange boolean and replace boolean. Existing credentials require replace=true. The password hash and fresh random session secret go only into DATA_DIR/private/admin.json. Never copy a repository session secret. Existing scrypt hashes can instead be migrated in that file with a freshly rotated secret/version. On first successful login the helper verify-scrypt.cjs (REWEAR_SCRYPT_NODE, default /usr/bin/node10) verifies the legacy hash through stdin, then PHP replaces it with Argon2id when available, or bcrypt. No Node service is required after migration. Credential changes rotate the version and revoke prior sessions. Account and catalog transactions use separate private flock files plus atomic replacement; passwords and allow-list changes cannot race with authenticated writes.

The public catalog exposes active products, including sold items. Sitemap omits inactive and sold products. Share cards omit inactive products. Catalog mutations validate all fields, notes and actual JPEG/PNG/WebP headers and dimensions before writing; photos are never executable. Removed images are deleted only after catalog commit and only if no product still uses them.

Verification:

    php -l php/backend.php
    php -l php/router.php
    php -l php/index.php
    php -l php/init-account.php
    node --check php/verify-scrypt.cjs

For local runtime, configure REWEAR_DATA_DIR and REWEAR_SITE_URL before `php -S 127.0.0.1:8080 php/router.php`. Keep the configured HTTPS origin for request protection even when testing through an HTTP tunnel; the integration test sends that origin explicitly and manually forwards the Secure cookie.

Use an isolated staging data directory and account. Set BASE_URL to staging or its SSH tunnel URL, SITE_ORIGIN to configured HTTPS origin, PHP_TEST_LOGIN and PHP_TEST_PASSWORD to staging credentials, then run `node --test test/php-http.test.mjs`. Tests create and remove one product and update the account with unchanged login/password and an empty allow-list, so sessions rotate. Do not run against a production account that needs an IP restriction. Test uses the repository's real og.jpg as a JPEG fixture. Without BASE_URL the test runs local PHP lint and fails clearly if no PHP runtime exists; a skip is never treated as a runtime pass.

Set PHP_TEST_THROTTLE=1 to additionally exercise the per-IP lockout. This intentionally locks the isolated staging client for 15 minutes; remove only the staging private/throttle.json after the PHP workers stop if an immediate reset is needed. Throttle state is private, flock-protected and persisted before responses.

# Admin Bootstrap

To create the first ADMIN account securely:

1. Ensure the target user exists (register or sign in first).
2. Set environment variables:
   - BOOTSTRAP_ADMIN_ENABLED=true
   - BOOTSTRAP_ADMIN_EMAIL=admin@example.com
3. Run:
   
px tsx scripts/bootstrap-admin.ts
4. Unset the environment variables after use.

This script does not create an AdminProfile, is idempotent, and only works via explicit configuration.

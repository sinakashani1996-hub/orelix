# Execution

Store deterministic Python scripts here. Scripts should:

- Accept explicit inputs
- Read secrets from `.env`
- Write temporary artifacts to `.tmp/`
- Be commented where behavior is not obvious
- Be testable without manual intervention where practical

Shared platform behavior belongs in `orelix_office_core.py`. Individual module
scripts should use its case state, provider-message idempotency, approval policy,
and audit events rather than treating email labels as a database.

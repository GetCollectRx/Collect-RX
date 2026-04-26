# Field-level encryption policy (P5-03)

- **v1 (Collect-RX):** sensitive fields (names, contact, financial) are stored in PostgreSQL **without** application-level encryption; access is via authenticated API with `practiceId` scoping and TLS in transit.
- **If** a customer or regulator **requires** field- or record-level encryption: open an engineering ticket for envelope encryption with a managed KMS, key rotation, and backup/restore implications. Do not enable ad hoc crypto without a key lifecycle.

This document records the **program decision** for the default; change it if policy changes.

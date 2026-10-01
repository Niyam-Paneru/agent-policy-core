# Policy decision table

| Condition | Result | Why |
|---|---|---|
| capability unknown | deny | no implicit permission |
| origin outside grant | deny | destination is part of authority |
| grant expired | deny / narrow | old review does not authorize new work |
| provenance requirement unmet | deny | agent output cannot impersonate human authority |
| effect already committed | do not replay | side effect already exists |
| effect intent exists but outcome unknown | stop | duplicate success may be worse than failure |
| all reviewed conditions satisfied | allow | transport may now be invoked |

The table is intentionally boring. Boring policy is easier to audit.

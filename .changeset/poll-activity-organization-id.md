---
"@0xkey-io/core": patch
---

Activity polling now queries the organization the activity belongs to.
Previously `get_activity` fell back to the session's organization, or to
`config.organizationId` when there was no session, so polling a
sub-organization activity submitted by a parent-organization key (including
the re-poll after `onMfaRequired`, and pending activities returned to
`sendSignedRequest`) queried the parent organization and failed or never
reached a terminal status. Ports the semantics of the upstream Turnkey fix
"poll activities in the organization they belong to".

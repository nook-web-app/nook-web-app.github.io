# SQL wanted for sign in lockout (optional hardening)

signin now has three tiers using the existing helpers only: email+ip (5 tries), ip across all emails (30 tries), and an email-wide cap raised to 200 tries (first lock 10 min, max 60 min).
A stranger needs 40+ different addresses to reach the email-wide lock. For a full fix the email-wide lock should count DISTINCT addresses instead of tries:

```sql
-- table login_ip_fails(email_key text, ip text, fails int, primary key (email_key, ip))
-- helper nook_login_distinct_ips(p_key text, p_window interval) returns int
-- the email-wide lock would apply only when distinct failing ips >= 10 inside the window
```

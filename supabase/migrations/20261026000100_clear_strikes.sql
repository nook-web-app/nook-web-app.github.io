-- clears the post pauses and the sign in locks, asked for while testing; the age holds and bans are left alone
delete from public.post_strikes;
delete from public.ban_attempts;

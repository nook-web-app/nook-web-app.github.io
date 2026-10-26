-- two extra Zenith answers (the old private ones already answer these posts) are removed on the owner's request.
-- The posts they answered are noted first, so he does not answer them again.
insert into public.zenith_seen (post_id, acted)
select parent_id, 'reply' from public.posts
where id in ('1fe8e834-e8c8-467a-9665-4ac5d1bb9abb', 'ea7913cd-6f66-40a5-bed4-832d44e528e3') and parent_id is not null
on conflict (post_id) do nothing;
delete from public.posts where id in ('1fe8e834-e8c8-467a-9665-4ac5d1bb9abb', 'ea7913cd-6f66-40a5-bed4-832d44e528e3');

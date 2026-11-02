-- removes the throwaway accounts that the live tests created (nook.live.*@example.com); real accounts never use that address
delete from auth.users where email like 'nook.live.%@example.com';

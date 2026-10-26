-- removes the fake test accounts left by the automatic checks (the reserved .test domain, so never a real person)
delete from auth.users where email like '%@nook.test';

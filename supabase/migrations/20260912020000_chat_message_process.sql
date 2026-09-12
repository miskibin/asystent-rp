alter table public.chat_messages
  add column if not exists process jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nowa rozmowa'
    check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_order bigint generated always as identity,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 50000),
  created_at timestamptz not null default now(),
  unique (thread_id, message_order),
  foreign key (thread_id, user_id)
    references public.chat_threads(id, user_id)
    on delete cascade
);

create index if not exists chat_threads_user_updated_idx
  on public.chat_threads(user_id, updated_at desc);
create index if not exists chat_messages_thread_order_idx
  on public.chat_messages(thread_id, message_order);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

revoke all on table public.chat_threads from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;
grant select, insert, update, delete on table public.chat_threads to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;
grant usage, select on sequence public.chat_messages_message_order_seq to authenticated;

drop policy if exists "chat_threads_select_own" on public.chat_threads;
create policy "chat_threads_select_own"
  on public.chat_threads for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_threads_insert_own" on public.chat_threads;
create policy "chat_threads_insert_own"
  on public.chat_threads for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_threads_update_own" on public.chat_threads;
create policy "chat_threads_update_own"
  on public.chat_threads for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_threads_delete_own" on public.chat_threads;
create policy "chat_threads_delete_own"
  on public.chat_threads for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own"
  on public.chat_messages for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own"
  on public.chat_messages for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_messages_update_own" on public.chat_messages;
create policy "chat_messages_update_own"
  on public.chat_messages for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

notify pgrst, 'reload schema';

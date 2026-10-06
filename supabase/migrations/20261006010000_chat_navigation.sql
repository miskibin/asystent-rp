alter table public.chat_threads
  add column if not exists pinned boolean not null default false,
  add column if not exists sort_order bigint not null default 0;

create index if not exists chat_threads_navigation_idx
  on public.chat_threads(user_id, pinned desc, sort_order, updated_at desc);

-- One transaction, RLS applies to every row. A client cannot reorder another user's chats.
create or replace function public.reorder_chat_threads(thread_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(array_length(thread_ids, 1), 0) > 50 then
    raise exception 'Too many threads';
  end if;
  update public.chat_threads t
  set sort_order = ordered.position
  from unnest(thread_ids) with ordinality as ordered(id, position)
  where t.id = ordered.id and t.user_id = auth.uid();
end;
$$;
revoke all on function public.reorder_chat_threads(uuid[]) from public, anon;
grant execute on function public.reorder_chat_threads(uuid[]) to authenticated;
notify pgrst, 'reload schema';

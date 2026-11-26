create extension if not exists pgcrypto;

-- 1. Students
create table
    if not exists public.students (
        telegram_id bigint primary key,
        username text,
        first_name text,
        last_name text,
        stream text check (stream in ('Natural Sc.', 'Social Sc.')),
        semester text,
        state text not null default 'start',
        created_at timestamptz not null default now (),
        updated_at timestamptz not null default now ()
    );

-- 2. Courses
create table
    if not exists public.courses (
        id uuid primary key default gen_random_uuid (),
        stream text not null check (stream in ('Natural Sc.', 'Social Sc.')),
        semester text not null,
        name text not null,
        active boolean not null default true,
        created_at timestamptz not null default now (),
        unique (stream, semester, name)
    );

-- 3. Payments
create table
    if not exists public.payments (
        id uuid primary key default gen_random_uuid (),
        telegram_id bigint not null references public.students (telegram_id),
        stream text not null,
        semester text not null,
        payment_method text not null check (payment_method in ('CBE', 'TELEBIRR')),
        amount numeric(12, 2),
        screenshot_file_id text,
        status text not null default 'awaiting_screenshot' check (
            status in (
                'awaiting_screenshot',
                'pending',
                'approved',
                'rejected'
            )
        ),
        rejection_reason text,
        reviewed_by bigint,
        reviewed_at timestamptz,
        created_at timestamptz not null default now ()
    );

-- 4. Invitation links
create table
    if not exists public.invite_links (
        id uuid primary key default gen_random_uuid (),
        payment_id uuid not null references public.payments (id),
        telegram_id bigint not null references public.students (telegram_id),
        invite_link text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now ()
    );

-- 5. Processed Telegram updates
create table
    if not exists public.processed_updates (
        update_id bigint primary key,
        processed_at timestamptz not null default now ()
    );

-- 6. Indexes
create index if not exists payments_student_idx on public.payments (telegram_id, created_at desc);

create index if not exists payments_status_idx on public.payments (status);

-- 7. Natural Science courses
insert into
    public.courses (stream, semester, name)
values
    ('Natural Sc.', 'Semester 1', '1. Mathematics'),
    ('Natural Sc.', 'Semester 1', '2. Physics'),
    ('Natural Sc.', 'Semester 1', '3. Logic'),
    ('Natural Sc.', 'Semester 1', '4. Psychology'),
    ('Natural Sc.', 'Semester 1', '5. Geography'),
    ('Natural Sc.', 'Semester 1', '6. English I'),
    (
        'Natural Sc.',
        'Semester 1',
        '7. Physical Fitness'
    ),
    -- 8. Social Science courses
    ('Social Sc.', 'Semester 1', '1. Mathematics'),
    ('Social Sc.', 'Semester 1', '2. Economics'),
    ('Social Sc.', 'Semester 1', '3. Logic'),
    ('Social Sc.', 'Semester 1', '4. Psychology'),
    ('Social Sc.', 'Semester 1', '5. Entrepreneurship'),
    ('Social Sc.', 'Semester 1', '6. English I'),
    ('Social Sc.', 'Semester 1', '7. Physical Fitness') on conflict (stream, semester, name) do nothing;
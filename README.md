# Naming Things

A [T3 Stack](https://create.t3.gg/) project built with Next.js, tRPC, Drizzle ORM, Tailwind CSS, and PostgreSQL.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [PostgreSQL](https://www.postgresql.org/) (v14+)

## Database Setup

### Install PostgreSQL (macOS)

```bash
brew install postgresql@17
brew services start postgresql@17
```

### Create the database

```bash
createdb naming-things
```

### Configure the connection

Copy the example env file and update the connection string:

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to match your local PostgreSQL setup:

```
DATABASE_URL="postgresql://<your-user>@localhost:5432/naming-things"
```

### Push the schema

```bash
npm run db:push
```

### Other database commands

```bash
npm run db:generate   # Generate migration files
npm run db:migrate    # Run migrations
npm run db:studio     # Open Drizzle Studio (GUI)
```

## Getting Started

```bash
npm install
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- [Next.js](https://nextjs.org) (App Router)
- [tRPC](https://trpc.io)
- [Drizzle ORM](https://orm.drizzle.team)
- [PostgreSQL](https://www.postgresql.org/)
- [Tailwind CSS](https://tailwindcss.com)

## Deployment

Follow the T3 deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify), and [Docker](https://create.t3.gg/en/deployment/docker).

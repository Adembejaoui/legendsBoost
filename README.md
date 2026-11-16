This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Riot API

- **Key:** set `RIOT_API_KEY` in `.env` (server only, never committed). League of Legends tracking (rank, match history, LP per game) uses it.
- **Status (2026-11-15):** League of Legends only. Valorant and TFT tracking, and manual rank reports by boosters, are not built yet: they wait for the needed API keys. Until then those orders are completed by an admin.
- **Production key:** register the product in the Riot Developer Portal before going live; development keys expire every 24 hours.
- **Switch off:** set the config `tracker_provider` to `manual` or `mock` to stop all Riot calls; orders keep working.
- **Policy:** Riot IDs only (no summoner names), the "not endorsed by Riot Games" notice is in the footer, match and rank history are deleted 15 days after an order ends (config `match_retention_days`). Progress is never shown as MMR.

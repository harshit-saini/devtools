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

## Peer-to-peer tools

Three tools connect browsers directly to each other rather than through this app:

| Route | Tool | What it does |
| --- | --- | --- |
| `/meet` | Peer Video Chat | Camera, microphone, screen sharing, and text chat |
| `/file-share` | Peer File Share | Chunked file transfer with progress and end-to-end checksums |
| `/live-notepad` | Live Notepad | One shared note edited concurrently, with live cursors |

Media, file bytes, and note contents travel straight between browsers over WebRTC. A separate
signaling server ([peer-server](https://github.com/harshit-saini/peer-server)) only introduces
peers to each other by room code and relays the SDP and ICE messages needed to open the
connection; it never sees any content.

### Running them locally

1. Start the signaling server (defaults to port 8080):

   ```bash
   cd ../peer-server && npm install && npm run dev
   ```

2. Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_PEER_SERVER_URL` at it. The default
   (`ws://localhost:8080`) already matches the command above.

3. `npm run dev`, open one of the routes in two browser windows, and join the same room code -
   the invite-link button copies a URL that carries the code for you.

### Things worth knowing

- **A secure context is required.** `getUserMedia`, `getDisplayMedia`, and `crypto.subtle` only
  work over HTTPS or on `localhost`, and a page served over HTTPS cannot open a `ws://` socket. To
  test across two machines, run `npm run dev:https` and put TLS in front of the signaling server so
  it can be reached over `wss://`.
- **`Permissions-Policy` is set app-wide, not per route** (`next.config.ts`). The header binds to
  the document, and a client-side navigation does not fetch a new one - so a camera grant scoped to
  `/meet` would work on a hard load and fail silently after navigating there from another tool.
- **STUN only, by default.** Most home and office networks connect fine, but symmetric NAT and
  restrictive corporate firewalls cannot be traversed without a relay; those connections fail and
  the UI says so. Set `NEXT_PUBLIC_TURN_URLS` to supply one.
- **Anyone with a room code can join it.** Codes are generated from the platform CSPRNG at roughly
  35 bits, and a room exists only while its members are connected, but the code is the only thing
  keeping others out. A direct connection also reveals your IP address to the other peers.
- **Nothing is persisted.** A shared note lives only in the open tabs; received files sit in the
  tab's memory until saved, which is why transfers are capped at 256 MB.

### Shared implementation

`src/lib/webrtc/` holds the parts all three tools share: the signaling client, the peer mesh and
its negotiation, the in-band message protocol and its validators, a Logoot sequence CRDT for the
notepad, and the file-transfer chunking and integrity checks. The pure logic there is unit tested
under `src/lib/webrtc/*.test.ts`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

/**
 * Discord domain verification.
 *
 * WHY THIS IS A ROUTE AND NOT A DNS RECORD:
 *
 * Discord offers two ways to prove you control a domain — a TXT record at
 * `_discord.<domain>`, or this file served over HTTPS. The TXT route is
 * impossible here: the site lives on `market-calendar-three.vercel.app`, and
 * the `vercel.app` zone belongs to Vercel, not to us. Nobody outside Vercel
 * can add records under it. Serving the same token over HTTPS from a path we
 * do control is the equivalent proof, which is what Discord's "Verify using
 * HTTPS" button checks.
 *
 * The token is not a secret — it is a public claim check, like a Google site
 * verification file — so it lives in the repo rather than in an env var.
 *
 * Discord fetches this anonymously. If Vercel Authentication is ever turned
 * back on under Settings -> Deployment Protection, the fetch gets a 302 to
 * the SSO login wall and verification fails with no useful error (same trap
 * documented for the cron route in README.md).
 */
const DISCORD_DOMAIN_HASH = 'dh=d1b47aa8a21f5c813c6e37b9548b848fc916965c';

// Prerender once at build time: the response never varies by request.
export const dynamic = 'force-static';

export async function GET() {
	return new Response(DISCORD_DOMAIN_HASH, {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
}

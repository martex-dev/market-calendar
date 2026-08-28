import { redirect } from 'next/navigation';
import { todayET } from '@/lib/time';

/**
 * Week view is the default landing view (per session scope), anchored on
 * today in ET rather than the server's local date.
 *
 * MUST be dynamic. The redirect target is computed from the clock, so if this
 * route is prerendered the date is frozen at whenever the page was generated
 * and every visitor lands on that day until it is regenerated. A calendar
 * whose "today" is yesterday is the one failure this product cannot have.
 */
export const dynamic = 'force-dynamic';

export default function Home() {
	redirect(`/week/${todayET()}`);
}

import { redirect } from 'next/navigation';
import { todayET } from '@/lib/time';

/**
 * Week view is the default landing view (per session scope), anchored on
 * today in ET rather than the server's local date.
 */
export default function Home() {
	redirect(`/week/${todayET()}`);
}

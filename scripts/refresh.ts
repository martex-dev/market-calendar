/**
 * Local seeding: `npm run refresh`.
 *
 * Same code path the cron route uses, so what you see locally is what runs in
 * production.
 */
import { runRefresh } from '../src/lib/refresh';

runRefresh()
	.then((summary) => {
		console.log(JSON.stringify(summary, null, 2));
		process.exitCode = summary.ok ? 0 : 1;
	})
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});

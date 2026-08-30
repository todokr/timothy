export function epochMills(): number {
	return Date.now();
}

export function now(): Date {
	return new Date(epochMills());
}

export function addSeconds(date: Date, seconds: number): Date {
	return new Date(date.getTime() + seconds * 1000);
}

/** null は無期限。Date.parse の NaN 比較に頼らず、明示的に期限なしと判定する。 */
export function isExpired(iso: string | null, nowMs: number): boolean {
	if (iso === null) return false;
	return Date.parse(iso) < nowMs;
}

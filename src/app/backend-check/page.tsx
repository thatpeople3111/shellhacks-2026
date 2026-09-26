'use client';
import { useState } from 'react';
import { planTrip, suggestStops } from '../../lib/routewise';
import type { TripRequest, StopCategory, SuggestedStop, SuggestStopsResponse, TripPlan } from '../../lib/types';

export default function BackendCheck() {
  const [origin, setOrigin] = useState('FIU Modesto A. Maidique Campus, Miami');
  const [destination, setDestination] = useState('Wynwood Walls, Miami');
  const [departure, setDeparture] = useState('');
  const [hasCar, setHasCar] = useState(true);
  const [budget, setBudget] = useState('30');
  const [walking, setWalking] = useState('20');
  const [trip, setTrip] = useState<TripRequest | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestStopsResponse | null>(null);
  const [category, setCategory] = useState<StopCategory>('coffee');
  const [timing, setTiming] = useState<'ON_ROUTE' | 'DESTINATION'>('ON_ROUTE');
  const [extraTime, setExtraTime] = useState('30');
  const [extraBudget, setExtraBudget] = useState('');
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const preferences = { category, timing, maxExtraMinutes: Number(extraTime), ...(extraBudget === '' ? {} : { maxExtraBudget: Number(extraBudget) }), skip: false };
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(''); }
  }
  async function begin() {
    await run('Planning your route…', async () => {
      const input: TripRequest = { origin, destination, hasCar, allowTransit: true, allowWalking: true, budget: Number(budget), maxWalkingMinutes: Number(walking), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(departure ? { departureTime: new Date(departure).toISOString() } : {}) };
      const result = await suggestStops(input); setTrip(input); setSuggestions(result); setPlan(null);
    });
  }
  async function finish(stop?: SuggestedStop) {
    if (!trip) return;
    await run(stop ? 'Recalculating your trip with the stop…' : 'Comparing your routes…', async () => {
      setPlan(await planTrip({ ...trip, stopPreferences: stop ? preferences : { skip: true }, ...(stop ? { selectedStop: stop } : {}) }));
    });
  }
  function clearStops() { if (suggestions) setSuggestions({ ...suggestions, stops: [] }); }
  const field = 'block w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950';
  const button = 'rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50';
  return <main className="min-h-screen bg-slate-100 p-6 text-slate-950 sm:p-10"><div className="mx-auto max-w-5xl space-y-6">
    <header><p className="text-sm font-semibold uppercase tracking-widest text-blue-700">RouteWise • Connection check</p><h1 className="mt-2 text-3xl font-bold">Plan a trip. Add a stop. Compare routes.</h1><p className="mt-3 text-slate-600">This page exercises the API your teammate’s frontend can use. Prices and opening hours may be unavailable.</p></header>
    <form className="rounded-2xl bg-white p-6 shadow-sm" onSubmit={e => { e.preventDefault(); void begin(); }}><fieldset disabled={!!busy} className="grid gap-4 sm:grid-cols-2">
      <label>Origin<input required className={field} value={origin} onChange={e => setOrigin(e.target.value)} /></label>
      <label>Destination<input required className={field} value={destination} onChange={e => setDestination(e.target.value)} /></label>
      <label>Leave at (optional, local time)<input type="datetime-local" className={field} value={departure} onChange={e => setDeparture(e.target.value)} /></label>
      <label>Transport budget (USD)<input type="number" min="0" max="1000" required className={field} value={budget} onChange={e => setBudget(e.target.value)} /></label>
      <label>Maximum walking minutes<input type="number" min="0" max="180" required className={field} value={walking} onChange={e => setWalking(e.target.value)} /></label>
      <label className="flex items-center gap-3"><input type="checkbox" checked={hasCar} onChange={e => setHasCar(e.target.checked)} />I have a car</label><button className={button} type="submit">Plan my trip</button>
    </fieldset></form>
    <p role="status" aria-live="polite">{busy}</p>{error && <p role="alert" className="rounded-lg bg-red-100 p-4 text-red-900">{error}</p>}
    {suggestions && trip && !plan && <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"><p className="text-sm font-semibold uppercase">{suggestions.dataMode} data</p><h2 className="text-2xl font-bold">Would you like to add a stop?</h2><fieldset disabled={!!busy} className="space-y-4">
      <div className="flex flex-wrap gap-2">{suggestions.categories.map(c => <button key={c} aria-pressed={category === c} className={`rounded-full border px-4 py-2 capitalize ${category === c ? 'bg-blue-700 text-white' : ''}`} onClick={() => { setCategory(c); clearStops(); }}>{c}</button>)}</div>
      <div className="grid gap-4 sm:grid-cols-3"><label>When<select className={field} value={timing} onChange={e => { setTiming(e.target.value as typeof timing); clearStops(); }}><option value="ON_ROUTE">On the way</option><option value="DESTINATION">After arriving</option></select></label>
      <label>Maximum extra minutes<input type="number" min="0" max="180" className={field} value={extraTime} onChange={e => { setExtraTime(e.target.value); clearStops(); }} /></label><label>Extra spending cap (optional)<input type="number" min="0" max="1000" placeholder="No cap" className={field} value={extraBudget} onChange={e => { setExtraBudget(e.target.value); clearStops(); }} /></label></div>
      <p className="text-sm text-slate-600">Includes a 5-minute visit. A spending cap excludes places without a published price range.</p><div className="flex gap-3"><button className={button} onClick={() => void run('Finding and checking stops…', async () => { setSuggestions(await suggestStops({ ...trip, stopPreferences: preferences })); })}>Find stop</button><button className="rounded-lg border px-5 py-3" onClick={() => void finish()}>Skip stop</button></div>
      {suggestions.status === 'no_matching_stops' && <p>No stop could be verified within these limits. Adjust the options or skip.</p>}{suggestions.status === 'no_matching_routes' && <p>No matching route. Try changing the trip limits above.</p>}
      {suggestions.stops.map(stop => <article className="rounded-xl border p-4" key={stop.id}><h3 className="font-bold">{stop.name}</h3><p>{stop.address}</p><p>+{stop.estimatedExtraMinutes} min • {stop.estimatedCost === undefined ? 'Spending unknown' : `Estimated spending up to $${stop.estimatedCost}`}</p><button className={`${button} mt-3`} onClick={() => void finish(stop)}>Add this stop</button></article>)}
    </fieldset><details><summary>Data notes</summary><ul className="list-disc pl-5">{suggestions.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details></section>}
    {plan && <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold">Your route options</h2><button disabled={!!busy} className="rounded-lg border px-4 py-2" onClick={() => setPlan(null)}>Change stop</button></div><p>{plan.dataMode.toUpperCase()} data • Ranking: {plan.rankingSource}</p>{!plan.routes.length && <p>No matching itinerary. Adjust the limits or skip the stop.</p>}
      <div className="grid gap-4 lg:grid-cols-3">{plan.routes.map(route => <article key={route.id} className="space-y-3 rounded-2xl bg-white p-6 shadow-sm"><p className="font-bold text-blue-700">{route.label}</p><h3 className="text-xl font-bold">{route.title}</h3><p className="text-2xl">{route.durationMinutes} min</p><p>{route.estimatedCost === null ? 'Total cost unknown' : `$${route.estimatedCost.toFixed(2)} estimated total`}</p><p>Walking: {route.walkingMinutes ?? 'Unknown'} min</p><p>{route.reason}</p><ol className="list-decimal space-y-2 pl-5 text-sm">{route.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>{route.navigationLinks.map((link, i) => <a className="block text-blue-700 underline" key={`${link}-${i}`} href={link} target="_blank" rel="noreferrer">Open directions {i + 1}</a>)}<details><summary>Constraints and cost notes</summary><p>{route.cost.note}</p>{route.transitAgencies.map(a => <p key={a.name}>{a.url ? <a href={a.url} className="underline">{a.name}</a> : a.name}</p>)}<p>Budget: {route.constraints.budget}; walking: {route.constraints.walking}; arrival: {route.constraints.arrival}</p>{route.warnings.map((w, i) => <p key={i}>{w}</p>)}</details></article>)}</div>
      <ul className="list-disc pl-5">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p className="text-sm">{plan.attribution}</p></section>}
  </div></main>;
}

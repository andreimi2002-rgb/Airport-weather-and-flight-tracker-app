// Airport lookup for the functions. The list is bundled into each function,
// so only real airports can be queried.
import data from "../../public/data/airports.json" with { type: "json" };

const F = Object.fromEntries(data.fields.map((f, i) => [f, i]));
const byIata = new Map(data.airports.map(r => [r[F.iata], r]));

export const isAirportCode = code => /^[A-Z0-9]{3}$/.test(code);

const iataByIcao = new Map(data.airports.filter(r => r[F.icao]).map(r => [r[F.icao], r[F.iata]]));
// "LROP" -> "OTP" (null when the ICAO code is not in our list)
export const iataForIcao = icao => iataByIcao.get(String(icao || "").toUpperCase()) || null;

export function findAirport(code) {
  const r = byIata.get(code);
  return r && { iata: r[F.iata], icao: r[F.icao] || null, name: r[F.name], city: r[F.city] || null, lat: r[F.lat], lon: r[F.lon], elevationFt: r[F.elevationFt], tz: r[F.tz] || null };
}

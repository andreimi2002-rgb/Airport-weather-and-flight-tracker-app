// DEMO DATA. Illustrative values for the prototype, not live information.
// Shown only while no flight data provider is connected, and labelled demo.
// Anything not listed here is shown as "not available", never invented.

// Illustrative aircraft photo for the demo flight detail (not the actual
// aircraft; labelled as such). Airport and city photos now come from
// Wikimedia Commons, see photos.js.
export const demoAircraftPhoto = "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1000&q=85";

// The four airports suggested in the picker before the user types.
export const demoAirportCodes = ["SEA", "LHR", "OTP", "JFK"];

// Sample flight board. Seattle (SEA) only. Compact rows, turned into the
// same flight model the live provider uses (see flight-model.js).
const SEA_ROWS = [
  ["departures", "AS 214", "Alaska Airlines", "Los Angeles", "LAX", "05:35", "05:42", "N", "C12", "Boarding", "Boeing 737-900", "Boeing", "2h 45m", "954 mi"],
  ["arrivals", "DL 381", "Delta Air Lines", "Minneapolis", "MSP", "05:42", "05:39", null, null, "On time", "Airbus A321", "Airbus", "3h 20m", "1,395 mi"],
  ["departures", "DL 1678", "Delta Air Lines", "Atlanta", "ATL", "06:05", "06:05", "S", "A4", "On time", "Boeing 737-800", "Boeing", "4h 35m", "2,184 mi"],
  ["arrivals", "UA 2241", "United Airlines", "Denver", "DEN", "06:12", "06:28", null, null, "Delayed", "Boeing 737 MAX 9", "Boeing", "2h 55m", "1,024 mi"],
  ["departures", "BA 48", "British Airways", "London Heathrow", "LHR", "06:25", "06:25", "I", "S8", "On time", "Boeing 787-9", "Boeing", "9h 30m", "4,786 mi"],
  ["arrivals", "AS 331", "Alaska Airlines", "San Francisco", "SFO", "06:31", "06:31", null, null, "On time", "Embraer E175", "Embraer", "2h 10m", "679 mi"],
  ["departures", "WN 908", "Southwest Airlines", "Phoenix", "PHX", "06:48", "07:10", "C", "B7", "Delayed", "Boeing 737-800", "Boeing", "2h 55m", "1,110 mi"],
  ["arrivals", "AC 542", "Air Canada", "Vancouver", "YVR", "07:02", "07:02", null, null, "On time", "Airbus A220-300", "Airbus", "1h 05m", "127 mi"],
  ["departures", "UA 1593", "United Airlines", "Chicago O’Hare", "ORD", "07:18", "07:18", "S", "A10", "On time", "Boeing 737 MAX 8", "Boeing", "4h 05m", "1,720 mi"],
  ["arrivals", "AF 338", "Air France", "Paris Charles de Gaulle", "CDG", "07:24", "07:41", null, null, "Delayed", "Boeing 787-9", "Boeing", "10h 05m", "5,000 mi"],
  ["departures", "AS 702", "Alaska Airlines", "Anchorage", "ANC", "07:40", "07:40", "N", "C8", "On time", "Boeing 737-900", "Boeing", "3h 30m", "1,445 mi"],
  ["arrivals", "LH 490", "Lufthansa", "Frankfurt", "FRA", "07:53", "07:53", null, null, "Landed", "Airbus A350-900", "Airbus", "10h 20m", "5,090 mi"],
  ["departures", "AA 2774", "American Airlines", "Dallas/Fort Worth", "DFW", "08:05", "08:05", "S", "D3", "Cancelled", "Boeing 737-800", "Boeing", "3h 55m", "1,665 mi"],
];
const DEMO_STATUS = { "On time": "expected", Boarding: "boarding", Delayed: "delayed", Landed: "arrived", Cancelled: "cancelled" };
const minutes = s => { const m = /(?:(\d+)h)?\s*(\d+)m/.exec(s); return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null; };
const demoTime = hm => ({ utc: null, local: "2000-01-01T" + hm });

function demoFlight([type, number, airline, city, code, scheduled, estimated, terminal, gate, status, model, manufacturer, duration, distance]) {
  const direction = type === "departures" ? "departure" : "arrival";
  const sea = { iata: "SEA", icao: "KSEA", name: "Seattle–Tacoma", city: "Seattle", country: "US" };
  const far = { iata: code, icao: null, name: city, city, country: null };
  const hereMove = { airport: sea, scheduled: demoTime(scheduled), revised: demoTime(estimated), runway: null, terminal, gate, checkInDesk: null, baggageBelt: null, live: false };
  const farMove = { airport: far, scheduled: null, revised: null, runway: null, terminal: null, gate: null, checkInDesk: null, baggageBelt: null, live: false };
  const [h1, m1] = scheduled.split(":").map(Number), [h2, m2] = estimated.split(":").map(Number);
  return {
    id: "demo|" + number, direction, number, callSign: null,
    airline: { name: airline, iata: number.split(" ")[0], icao: null },
    status: DEMO_STATUS[status], providerStatus: null,
    departure: direction === "departure" ? hereMove : farMove,
    arrival: direction === "arrival" ? hereMove : farMove,
    delayMinutes: (h2 * 60 + m2) - (h1 * 60 + m1),
    distanceKm: Math.round(Number(distance.replace(/[^\d]/g, "")) * 1.609344),
    scheduledDurationMinutes: minutes(duration),
    isCargo: false,
    aircraft: { registration: null, model, modeS: null, photo: null, manufacturer },
    updatedAt: null,
    demo: true,
  };
}

export const demoFlights = { SEA: SEA_ROWS.map(demoFlight) };

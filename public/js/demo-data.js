// DEMO DATA. Illustrative values for the prototype, not live information.
// Replaced step by step by real sources (weather, flights, photos).
// Anything not listed here is shown as "not available", never invented.

// Illustrative aircraft photo for the demo flight detail (not the actual
// aircraft; labelled as such). Airport and city photos now come from
// Wikimedia Commons, see photos.js.
export const demoAircraftPhoto = "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1000&q=85";

// The four airports suggested in the picker before the user types.
export const demoAirportCodes = ["SEA", "LHR", "OTP", "JFK"];

// Sample flight board. Seattle (SEA) only.
export const demoFlights = {
  SEA: [
    { type: "departures", flight: "AS 214", airline: "Alaska Airlines", city: "Los Angeles", code: "LAX", scheduled: "05:35", estimated: "05:42", terminal: "N", gate: "C12", status: "Boarding", aircraft: "Boeing 737-900", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "LAX", toCity: "Los Angeles", duration: "2h 45m", distance: "954 mi" },
    { type: "arrivals", flight: "DL 381", airline: "Delta Air Lines", city: "Minneapolis", code: "MSP", scheduled: "05:42", estimated: "05:39", terminal: "—", gate: "—", status: "On time", aircraft: "Airbus A321", manufacturer: "Airbus", from: "MSP", fromCity: "Minneapolis", to: "SEA", toCity: "Seattle", duration: "3h 20m", distance: "1,395 mi" },
    { type: "departures", flight: "DL 1678", airline: "Delta Air Lines", city: "Atlanta", code: "ATL", scheduled: "06:05", estimated: "06:05", terminal: "S", gate: "A4", status: "On time", aircraft: "Boeing 737-800", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "ATL", toCity: "Atlanta", duration: "4h 35m", distance: "2,184 mi" },
    { type: "arrivals", flight: "UA 2241", airline: "United Airlines", city: "Denver", code: "DEN", scheduled: "06:12", estimated: "06:28", terminal: "—", gate: "—", status: "Delayed", aircraft: "Boeing 737 MAX 9", manufacturer: "Boeing", from: "DEN", fromCity: "Denver", to: "SEA", toCity: "Seattle", duration: "2h 55m", distance: "1,024 mi" },
    { type: "departures", flight: "BA 48", airline: "British Airways", city: "London Heathrow", code: "LHR", scheduled: "06:25", estimated: "06:25", terminal: "I", gate: "S8", status: "On time", aircraft: "Boeing 787-9", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "LHR", toCity: "London", duration: "9h 30m", distance: "4,786 mi" },
    { type: "arrivals", flight: "AS 331", airline: "Alaska Airlines", city: "San Francisco", code: "SFO", scheduled: "06:31", estimated: "06:31", terminal: "—", gate: "—", status: "On time", aircraft: "Embraer E175", manufacturer: "Embraer", from: "SFO", fromCity: "San Francisco", to: "SEA", toCity: "Seattle", duration: "2h 10m", distance: "679 mi" },
    { type: "departures", flight: "WN 908", airline: "Southwest Airlines", city: "Phoenix", code: "PHX", scheduled: "06:48", estimated: "07:10", terminal: "C", gate: "B7", status: "Delayed", aircraft: "Boeing 737-800", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "PHX", toCity: "Phoenix", duration: "2h 55m", distance: "1,110 mi" },
    { type: "arrivals", flight: "AC 542", airline: "Air Canada", city: "Vancouver", code: "YVR", scheduled: "07:02", estimated: "07:02", terminal: "—", gate: "—", status: "On time", aircraft: "Airbus A220-300", manufacturer: "Airbus", from: "YVR", fromCity: "Vancouver", to: "SEA", toCity: "Seattle", duration: "1h 05m", distance: "127 mi" },
    { type: "departures", flight: "UA 1593", airline: "United Airlines", city: "Chicago O’Hare", code: "ORD", scheduled: "07:18", estimated: "07:18", terminal: "S", gate: "A10", status: "On time", aircraft: "Boeing 737 MAX 8", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "ORD", toCity: "Chicago", duration: "4h 05m", distance: "1,720 mi" },
    { type: "arrivals", flight: "AF 338", airline: "Air France", city: "Paris Charles de Gaulle", code: "CDG", scheduled: "07:24", estimated: "07:41", terminal: "—", gate: "—", status: "Delayed", aircraft: "Boeing 787-9", manufacturer: "Boeing", from: "CDG", fromCity: "Paris", to: "SEA", toCity: "Seattle", duration: "10h 05m", distance: "5,000 mi" },
    { type: "departures", flight: "AS 702", airline: "Alaska Airlines", city: "Anchorage", code: "ANC", scheduled: "07:40", estimated: "07:40", terminal: "N", gate: "C8", status: "On time", aircraft: "Boeing 737-900", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "ANC", toCity: "Anchorage", duration: "3h 30m", distance: "1,445 mi" },
    { type: "arrivals", flight: "LH 490", airline: "Lufthansa", city: "Frankfurt", code: "FRA", scheduled: "07:53", estimated: "07:53", terminal: "—", gate: "—", status: "Landed", aircraft: "Airbus A350-900", manufacturer: "Airbus", from: "FRA", fromCity: "Frankfurt", to: "SEA", toCity: "Seattle", duration: "10h 20m", distance: "5,090 mi" },
    { type: "departures", flight: "AA 2774", airline: "American Airlines", city: "Dallas/Fort Worth", code: "DFW", scheduled: "08:05", estimated: "08:05", terminal: "S", gate: "D3", status: "Cancelled", aircraft: "Boeing 737-800", manufacturer: "Boeing", from: "SEA", fromCity: "Seattle", to: "DFW", toCity: "Dallas", duration: "3h 55m", distance: "1,665 mi" },
  ],
};

// Counts shown in the four stat cards, computed from the listed flights
// so they always match the board.
export function flightStats(flights) {
  const dep = flights.filter(f => f.type === "departures");
  const arr = flights.filter(f => f.type === "arrivals");
  const onTime = list => list.filter(f => f.status === "On time" || f.status === "Boarding" || f.status === "Landed").length;
  return {
    departures: dep.length, departuresOnTime: onTime(dep),
    arrivals: arr.length, arrivalsOnTime: onTime(arr),
    delays: flights.filter(f => f.status === "Delayed").length,
    cancellations: flights.filter(f => f.status === "Cancelled").length,
  };
}

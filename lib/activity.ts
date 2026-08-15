type Details = Record<string, unknown>;
const title = (value: unknown) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const peso = (value: unknown) => `₱${((Number(value) || 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const names = (value: unknown) => Array.isArray(value) ? value.map(String).join(" • ") : "";

export function activityDescription(type: string, details: Details, playerName?: string | null, courtId?: number | null) {
  const player = playerName || "Player";
  const court = courtId ? `Court ${courtId}` : "the court";
  switch (type) {
    case "auto_pairing": return `Auto paired players${details.mode ? ` using ${title(details.mode)}` : ""}${details.tableNumber ? ` into Standby Table #${details.tableNumber}` : ""}.${details.players ? ` Players assigned: ${names(details.players)}.` : ""}`;
    case "standby_assigned": return `${player} moved to Standby Table #${details.tableNumber}.`;
    case "queue_joined": return `${player} joined the Waiting Queue.`;
    case "queue_returned": return `${player} returned to the Waiting Queue.`;
    case "queue_removed": return `${player} left the Waiting Queue.`;
    case "queue_notes_updated": return `Queue notes updated for ${player}.`;
    case "player_added": return `${player} was registered as ${title(details.gender)}, Level ${details.level}.`;
    case "player_updated": return `${player}'s profile was updated to ${title(details.gender)}, Level ${details.level}.`;
    case "player_level_changed": return `${player}'s player level was updated.`;
    case "court_assigned": return `Players assigned to ${court}: ${names(details.players)}.`;
    case "court_moved": return `Match moved from Court ${details.fromCourtId} to Court ${details.toCourtId}.`;
    case "shuttlecock_updated": return `${court} shuttlecock changed to ${details.shuttlecockName}.`;
    case "player_substitution": return `Lineup updated on ${court}. Current players: ${names(details.lineup)}.`;
    case "billing_updated": return `Billing updated for ${court}. New total: ${peso(details.totalCentavos)}.`;
    case "payment_recorded": return `Payment of ${peso(details.amountCentavos)} recorded for ${player}.`;
    case "player_charge_added": return `${title(details.chargeType)} of ${peso(details.amountCentavos)} added for ${player}: ${details.description || "No description"}.`;
    case "player_charge_updated": return `Charge updated for ${player}: ${details.description || "Charge"} — ${peso(details.amountCentavos)}.`;
    case "player_charge_removed": return `Charge removed from ${player}'s bill.`;
    case "game_completed": return `Match finished on ${court}. Winner: ${details.winner || "Not recorded"}. Players: ${names(details.players)}${details.notes ? `. Notes: ${details.notes}` : ""}.`;
    case "day_ended": return `End of day completed. ${details.games || 0} matches archived with ${peso(details.revenueCentavos)} in match revenue. The Player Directory was cleared and all live dashboards were reset for the next day.`;
    case "reservation_created": return `Reservation created for ${player}.`;
    case "reservation_updated": return `Reservation for ${player} changed from ${title(details.previousStatus)} to ${title(details.status)}.`;
    default: { const readable = Object.entries(details).map(([key, value]) => `${title(key)}: ${Array.isArray(value) ? names(value) : title(value)}`).join(" · "); return readable || `${title(type)} recorded.`; }
  }
}

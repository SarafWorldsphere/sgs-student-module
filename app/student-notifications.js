import { getApiBaseUrl } from "./api-base-url";

const API_BASE_URL = getApiBaseUrl();
let notificationRequest = null;
let notificationIdentity = "";

export async function loadStudentNotifications(identity) {
  const normalizedIdentity = String(identity || "").trim().toLowerCase();
  if (!normalizedIdentity) throw new Error("Logged-in student identity is unavailable.");

  if (!notificationRequest || notificationIdentity !== normalizedIdentity) {
    notificationIdentity = normalizedIdentity;
    notificationRequest = fetch(
      `${API_BASE_URL}/notifications?${new URLSearchParams({ email: identity }).toString()}`,
      { cache: "no-store" }
    ).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notificationRequest = null;
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load notifications.");
      }
      return data;
    }).catch((error) => {
      notificationRequest = null;
      throw error;
    });
  }

  return notificationRequest;
}

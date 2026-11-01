// Landing page profile: the owner's photo and name. The photo is a file in public/ (profile.jpg,
// .jpeg, .png or .webp); until one exists a monogram is shown, so the page never shows a broken image.
import fs from "node:fs";
import path from "node:path";
import { CONTACT } from "@/lib/contact";

const PHOTO_FILES = ["profile.jpg", "profile.jpeg", "profile.png", "profile.webp"];

function profilePhoto(): string | null {
  try {
    const dir = path.join(process.cwd(), "public");
    const file = PHOTO_FILES.find((f) => fs.existsSync(path.join(dir, f)));
    return file ? `/${file}` : null;
  } catch {
    return null;
  }
}

export function ProfileSection() {
  const photo = profilePhoto();
  return (
    <section
      id="profile"
      aria-labelledby="profile-heading"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:py-16"
    >
      <div className="panel flex flex-col md:flex-row md:items-center md:justify-between gap-6 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8 text-center sm:text-left flex-1">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={CONTACT.person}
              width={160}
              height={160}
              className="h-36 w-36 shrink-0 rounded-full object-cover shadow-md ring-4 ring-brand-100 sm:h-40 sm:w-40"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full bg-brand-600 text-4xl font-bold text-white shadow-md ring-4 ring-brand-100 sm:h-40 sm:w-40 sm:text-5xl"
            >
              {CONTACT.person.slice(0, 2)}
            </div>
          )}
          <div className="flex flex-col items-center sm:items-start">
            <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200/60">
              পরিচিতি
            </span>
            <h2
              id="profile-heading"
              className="mt-2 text-2xl font-bold text-ink-900 sm:text-3xl"
            >
              {CONTACT.person}
            </h2>
            <p className="mt-0.5 text-sm font-medium text-slate-600">
              {CONTACT.degree}
            </p>
            <p className="mt-1 text-base font-medium text-slate-700">
              {CONTACT.role}, বিজয় লেনদেন
            </p>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-slate-600 sm:justify-start">
              <span aria-hidden>📍</span>
              <span>{CONTACT.address}</span>
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
              {/* Call Button */}
              <a
                href={CONTACT.phoneHref}
                className="btn-secondary inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold shadow-xs hover:border-brand-500 hover:text-brand-700"
                title="কল করুন"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 shrink-0 text-slate-600"
                  aria-hidden="true"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>{CONTACT.phoneDisplay}</span>
              </a>

              {/* WhatsApp Button */}
              <a
                href={CONTACT.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                title="হোয়াটসঅ্যাপে চ্যাট"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-white"
                  aria-hidden="true"
                >
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                </svg>
                <span>হোয়াটসঅ্যাপে চ্যাট</span>
              </a>

              {/* Email Button */}
              <a
                href={CONTACT.emailHref}
                className="btn-secondary inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold shadow-xs hover:border-brand-500 hover:text-brand-700"
                title="ইমেইল"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 shrink-0 text-slate-500"
                  aria-hidden="true"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>{CONTACT.email}</span>
              </a>
            </div>

            {/* Mobile QR Disclosure */}
            <details className="mt-3 w-full text-center md:hidden group">
              <summary className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors list-none select-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden="true"
                >
                  <rect width="5" height="5" x="3" y="3" rx="1" />
                  <rect width="5" height="5" x="16" y="3" rx="1" />
                  <rect width="5" height="5" x="3" y="16" rx="1" />
                  <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
                  <path d="M21 21v.01" />
                  <path d="M12 7v3a2 2 0 0 1-2 2H7" />
                  <path d="M3 12h.01" />
                  <path d="M12 3h.01" />
                  <path d="M12 16v.01" />
                  <path d="M16 12h1" />
                  <path d="M21 12v.01" />
                  <path d="M12 21v-1" />
                </svg>
                <span>কিউআর কোড দেখুন</span>
              </summary>
              <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <a
                  href={CONTACT.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block relative p-2 rounded-lg bg-white border border-slate-100 hover:border-emerald-500 hover:shadow-md transition-all"
                  title="হোয়াটসঅ্যাপে চ্যাট করতে ক্লিক করুন"
                >
                  <img
                    src={CONTACT.qrImage}
                    alt="WhatsApp QR Code"
                    width={150}
                    height={150}
                    className="h-36 w-36 object-contain mx-auto"
                  />
                </a>
                <p className="mt-2 text-xs font-medium text-slate-600">
                  হোয়াটসঅ্যাপে চ্যাট করতে স্ক্যান করুন
                </p>
              </div>
            </details>
          </div>
        </div>

        {/* Desktop QR Code Card */}
        <div className="hidden md:flex flex-col items-center justify-center shrink-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:border-emerald-300 hover:shadow-md">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full mb-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
            <span>হোয়াটসঅ্যাপ চ্যাট</span>
          </div>
          <a
            href={CONTACT.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="group block relative p-2 bg-slate-50/70 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-white hover:shadow-md transition-all"
            title="হোয়াটসঅ্যাপে চ্যাট করতে ক্লিক বা স্ক্যান করুন"
          >
            <img
              src={CONTACT.qrImage}
              alt="WhatsApp QR Code"
              width={128}
              height={128}
              className="h-32 w-32 object-contain"
            />
          </a>
          <p className="mt-2 text-center text-xs font-medium text-slate-600 max-w-[140px] leading-tight">
            হোয়াটসঅ্যাপে চ্যাট করতে স্ক্যান করুন
          </p>
        </div>
      </div>
    </section>
  );
}

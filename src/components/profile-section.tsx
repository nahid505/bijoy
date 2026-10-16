// Landing page profile: the owner's photo and name. The photo is a file in public/ (profile.jpg,
// .jpeg, .png or .webp); until one exists a monogram is shown, so the page never shows a broken image.
import fs from "node:fs";
import path from "node:path";
import { CONTACT } from "@/lib/contact";

const PHOTO_FILES = ["profile.jpg", "profile.jpeg", "profile.png", "profile.webp"];

function profilePhoto(): string | null {
  const dir = path.join(process.cwd(), "public");
  const file = PHOTO_FILES.find((f) => fs.existsSync(path.join(dir, f)));
  return file ? `/${file}` : null;
}

export function ProfileSection() {
  const photo = profilePhoto();
  return (
    <section id="profile" aria-labelledby="profile-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
      <div className="panel flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:p-8 sm:text-left">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={CONTACT.person}
            width={160}
            height={160}
            className="h-40 w-40 shrink-0 rounded-full object-cover shadow-md ring-4 ring-brand-100"
          />
        ) : (
          <div aria-hidden className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full bg-brand-600 text-5xl font-bold text-white shadow-md ring-4 ring-brand-100">
            {CONTACT.person.slice(0, 2)}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">পরিচিতি</p>
          <h2 id="profile-heading" className="mt-1 text-3xl font-bold text-ink-900">{CONTACT.person}</h2>
          <p className="mt-1 text-lg text-slate-600">{CONTACT.role}, বিজয় লেনদেন</p>
          <p className="mt-3 text-slate-600">📍 {CONTACT.address}</p>
          <a href={CONTACT.phoneHref} className="btn-primary mt-4 inline-flex">📞 {CONTACT.phoneDisplay}</a>
        </div>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { EDITABLE_EVENTS, SMS_VARIABLES } from "@/lib/sms-text";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { resetSmsTemplateAction, saveSmsTemplateAction } from "@/server/actions/sms";
import { SmsTabs } from "../sms-ui";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "এসএমএস টেমপ্লেট" };

const GROUP_LABEL = { customer: "কাস্টমার", supplier: "সরবরাহকারী", inventory: "মজুদ ও মেয়াদ", security: "নিরাপত্তা" } as const;

export default async function SmsTemplatesPage() {
  const ctx = await requirePermission("sms:manage");
  const saved = new Map((await prisma.smsTemplate.findMany({ where: { businessId: ctx.business.id } })).map((t) => [t.event, t.body]));
  const extraVars = (key: string) => (key === "EXPIRY_WARNING" || key === "EXPIRED" ? ["batch_no", "quantity", "days"] : key === "LOW_STOCK" ? ["quantity"] : []);
  return (
    <>
      <PageHeader title="এসএমএস টেমপ্লেট" description={`বার্তায় ভেরিয়েবল ব্যবহার করুন: ${SMS_VARIABLES.map((v) => `{${v}}`).join(" ")}`} />
      <SmsTabs active="/sms/templates" canManage />
      <div className="grid gap-4 lg:grid-cols-2">
        {EDITABLE_EVENTS.map((e) => (
          <section key={e.key} className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{e.label}</h2>
              <span className="text-[11px] text-slate-500">{GROUP_LABEL[e.group]}{saved.has(e.key) ? " · পরিবর্তিত" : ""}</span>
            </div>
            <div className="p-4">
              <TemplateEditor
                body={saved.get(e.key) ?? e.defaultBody}
                variables={[...e.variables, ...extraVars(e.key)]}
                customised={saved.has(e.key)}
                save={saveSmsTemplateAction.bind(null, e.key)}
                reset={resetSmsTemplateAction.bind(null, e.key)}
              />
            </div>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">নিরাপত্তা কোড (OTP), নতুন লগইন সতর্কতা ও পাসওয়ার্ড রিসেটের বার্তা প্ল্যাটফর্মের নির্দিষ্ট লেখায় যায় — এগুলো পরিবর্তন করা যায় না।</p>
    </>
  );
}

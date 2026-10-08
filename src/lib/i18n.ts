// Bangla-first UI with an English option. Bangla strings are the keys; the English
// dictionary translates them. Untranslated strings fall back to Bangla.

export type Lang = "bn" | "en";
export const LANG_COOKIE = "bl_lang";

const EN: Record<string, string> = {
  // navigation
  "ড্যাশবোর্ড": "Dashboard", "লেনদেন": "Transactions", "রিসিপ্ট": "Receipt", "পেমেন্ট": "Payment", "জার্নাল": "Journal",
  "বিক্রয়": "Sales", "ক্রয়": "Purchase", "বিক্রয় ফেরত": "Sales Return", "ক্রয় ফেরত": "Purchase Return", "স্টক জার্নাল": "Stock Journal",
  "হিসাব": "Accounts", "লেজার": "Ledger", "ক্যাশ": "Cash", "ব্যাংক": "Bank", "দেনাদার": "Receivables", "পাওনাদার": "Payables",
  "পণ্য": "Products", "সকল পণ্য": "All Products", "ক্যাটাগরি": "Categories", "ব্র্যান্ড": "Brands", "ইউনিট": "Units", "স্টক": "Stock",
  "কাস্টমার": "Customers", "সরবরাহকারী": "Suppliers", "রিপোর্ট": "Reports", "ব্যবহারকারী": "Users", "ব্যবসা সেটিং": "Business Settings",
  "অ্যাকাউন্ট সেটিং": "Account Settings", "ব্যাকআপ": "Backup", "ব্যবহারকারী তালিকা": "User List", "রোল ও অনুমতি": "Roles & Permissions", "অডিট লগ": "Audit Log",
  "ডে বুক": "Day Book", "লেজার রিপোর্ট": "Ledger Report", "ট্রায়াল ব্যালেন্স": "Trial Balance", "লাভ-ক্ষতি": "Profit & Loss", "ব্যালান্স শীট": "Balance Sheet",
  "স্টক রিপোর্ট": "Stock Report", "কাস্টমার রিপোর্ট": "Customer Report", "সরবরাহকারী রিপোর্ট": "Supplier Report", "বিক্রয় রিপোর্ট": "Sales Report",
  "ক্রয় রিপোর্ট": "Purchase Report", "আয়-ব্যয় রিপোর্ট": "Income & Expense", "বাকি ও আদায়": "Dues & Collection", "কাস্টমার বাকি": "Customer Dues",
  "সরবরাহকারী দেনা": "Supplier Dues", "আদায় রিপোর্ট": "Collection Report", "খরচ রিপোর্ট": "Expense Report", "দৈনিক সারসংক্ষেপ": "Daily Summary",
  "নগদ প্রবাহ": "Cash Flow", "স্টক মূল্যায়ন": "Stock Valuation", "হিসাব যাচাই": "Integrity Check", "পস বিক্রয়": "POS Sale", "খরচ": "Expense",
  "হোম": "Home", "মেনু": "Menu",
  "ফিচার ব্যবস্থাপনা": "Feature Management", "চালু": "On", "বন্ধ": "Off", "ফ্রি": "Free", "পেইড": "Paid", "শীঘ্রই আসছে": "Coming soon",
  "চালু করুন": "Enable", "বন্ধ করুন": "Disable", "সব": "All", "অনুমতি": "Permissions", "🔍 ফিচার খুঁজুন…": "🔍 Search features…", "ফিচার খুঁজুন": "Search features",
  "ফিচার ফিল্টার": "Feature filter", "এই ফিল্টারে কোনো ফিচার নেই": "No features match this filter", "দেখা": "View", "তৈরি": "Create", "মুছা": "Delete",
  "এক্সপোর্ট": "Export", "অনুমোদন": "Approve", "চালু মডিউল": "Active modules", "সব ফিচার": "All features",
  "সাবস্ক্রিপশন": "Subscription", "প্ল্যানে নেই": "Not in plan", "যে প্ল্যানে আছে": "Included in", "কোনো প্ল্যানে নেই": "Not in any plan", "প্ল্যাটফর্ম অ্যাডমিন এই ফিচারটি বন্ধ রেখেছেন": "Disabled by the platform administrator", "আপগ্রেড করুন": "Upgrade", "নবায়ন করুন": "Renew", "প্ল্যান": "Plan", "ইনভয়েস": "Invoice", "মূল্য": "Pricing",
  "বেতন": "Payroll", "বেতন ড্যাশবোর্ড": "Payroll Dashboard", "কর্মচারী": "Employees", "হাজিরা": "Attendance", "মাসিক বেতন": "Monthly Payroll",
  "বেতন পরিশোধ": "Salary Payments", "অগ্রিম ও ঋণ": "Advances & Loans", "বেতন রিপোর্ট": "Payroll Reports", "বেতন সেটিং": "Payroll Settings",
  "পে-স্লিপ": "Payslip", "মূল বেতন": "Basic Salary", "মোট বেতন": "Gross Salary", "নিট বেতন": "Net Salary", "কর্তন": "Deductions", "ভাতা": "Allowances",
  "ওভারটাইম": "Overtime", "বিভাগ": "Department", "পদবি": "Designation", "যোগদানের তারিখ": "Joining Date", "কর্মচারী আইডি": "Employee ID",
  "উপস্থিত": "Present", "অনুপস্থিত": "Absent", "দেরি": "Late", "ছুটি (সবেতন)": "Paid Leave", "বিনা বেতনে ছুটি": "Unpaid Leave", "অর্ধদিবস": "Half Day", "ছুটির দিন": "Holiday",
  "খসড়া": "Draft", "চূড়ান্ত": "Finalized", "পরিশোধিত": "Paid", "অপরিশোধিত": "Unpaid", "আংশিক পরিশোধিত": "Partly paid",
  "মাসিক বেতন রিপোর্ট": "Monthly Payroll Report", "কর্মচারীর বেতন ইতিহাস": "Employee Salary History", "বেতন প্রদেয় রিপোর্ট": "Salary Payable Report",
  "বেতন পরিশোধ রিপোর্ট": "Salary Payment Report", "বিভাগভিত্তিক বেতন": "Department-wise Payroll", "ভাতা ও কর্তন রিপোর্ট": "Allowance & Deduction Report",
  "এসএমএস": "SMS", "এসএমএস ড্যাশবোর্ড": "SMS Dashboard", "এসএমএস পাঠান": "Send SMS", "এসএমএস লগ": "SMS Log", "এসএমএস টেমপ্লেট": "SMS Templates", "এসএমএস সেটিং": "SMS Settings",
  "ব্যাচ ও মেয়াদ": "Batches & Expiry", "নোটিফিকেশন": "Notifications", "মেয়াদ রিপোর্ট": "Expiry Report", "অপঠিত": "unread",
  "পণ্যের মেয়াদ": "Product Expiry", "সব ব্যাচ": "All batches", "মেয়াদোত্তীর্ণ": "Expired",
  "৭ দিনের মধ্যে মেয়াদ শেষ": "Expiring in 7 days", "১৫ দিনের মধ্যে মেয়াদ শেষ": "Expiring in 15 days", "৩০ দিনের মধ্যে মেয়াদ শেষ": "Expiring in 30 days", "৬০ দিনের মধ্যে মেয়াদ শেষ": "Expiring in 60 days",
  // shell
  "অর্থবছর": "FY", "আজ": "Today", "লগআউট": "Logout", "ভাষা": "Language",
  // dashboard
  "হিসাবের সারসংক্ষেপ": "Business summary", "আজকের বিক্রয়": "Today's sales", "আজকের ক্রয়": "Today's purchases", "আজকের আদায়": "Today's collection",
  "আজকের খরচ": "Today's expenses", "মোট পাওনা": "Total receivable", "মোট দেনা": "Total payable", "নগদ ব্যালেন্স": "Cash balance", "ব্যাংক ব্যালেন্স": "Bank balance",
  "কম মজুদের পণ্য": "Low-stock products", "মেয়াদোত্তীর্ণ বকেয়া": "Overdue customer dues", "সাম্প্রতিক বিক্রয়": "Recent sales", "সাম্প্রতিক পেমেন্ট": "Recent payments",
  "গত ৩০ দিন — বিক্রয় ও আদায়": "Last 30 days — sales & collection", "মাসিক বিক্রয় ও আদায় (চলতি অর্থবছর)": "Monthly sales & collection (this FY)",
  "দ্রুত কাজ": "Quick actions", "নতুন বিক্রয়": "New Sale", "নতুন ক্রয়": "New Purchase", "টাকা আদায়": "Receive Payment", "সরবরাহকারীকে পরিশোধ": "Pay Supplier",
  "কাস্টমার যোগ": "Add Customer", "পণ্য যোগ": "Add Product", "আজকের লাভ": "Today's profit", "মজুদ মূল্য": "Stock value", "মেয়াদ শেষ হচ্ছে": "Expiring soon",
  "সব দেখুন": "View all", "আদায়": "Collection",
  // common
  "সংরক্ষণ করুন": "Save", "বাতিল": "Cancel", "মুছুন": "Delete", "সম্পাদনা": "Edit", "প্রিন্ট": "Print", "খুঁজুন": "Search", "রিসেট": "Reset", "দেখুন": "View",
  "নিশ্চিত করুন": "Confirm", "হ্যাঁ, নিশ্চিত": "Yes, confirm", "না": "No", "অপেক্ষা করুন…": "Please wait…", "সংরক্ষণ হচ্ছে…": "Saving…",
  "কোনো তথ্য পাওয়া যায়নি": "No data found", "লোড হচ্ছে…": "Loading…",
  // page headers
  "বিক্রয় ভাউচার": "Sales voucher", "ক্রয় ভাউচার": "Purchase voucher", "রিসিপ্ট ভাউচার": "Receipt voucher", "পেমেন্ট ভাউচার": "Payment voucher",
  "জার্নাল ভাউচার": "Journal voucher", "বিক্রয় ফেরত ভাউচার": "Sales return voucher", "ক্রয় ফেরত ভাউচার": "Purchase return voucher",
  "লেজার (চার্ট অব অ্যাকাউন্টস)": "Ledger (Chart of Accounts)", "ক্যাশ বুক": "Cash Book", "ব্যাংক বুক": "Bank Book", "লাভ-ক্ষতি হিসাব": "Profit & Loss",
  "দেনাদার (কাস্টমার পাওনা)": "Receivables (customer dues)", "পাওনাদার (সরবরাহকারী দেনা)": "Payables (supplier dues)", "আমার ব্যবসাসমূহ": "My businesses",
};

export function translate(lang: Lang, text: string): string {
  return lang === "en" ? EN[text] ?? text : text;
}

export function isLang(v: string | undefined): v is Lang {
  return v === "bn" || v === "en";
}

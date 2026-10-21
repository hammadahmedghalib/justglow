(() => {
    const $ = id => document.getElementById(id);
    const cfg = window.APP_CONFIG || {};

    const ready = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_") &&
                  cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

    const db = ready ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

    let user = null;
    let records = [];
    let customers = [];
    let invoices = [];
    let audit = [];
    let edit = null;
    let type = "record";

    /* ---------- Formatters ---------- */
    const money = (n, c = "AED") =>
        `${c} ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const date = v => v
        ? new Date(v + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "—";

    const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

    const name = id => customers.find(c => c.id === id)?.name || "Unassigned";

    /* ---------- Toast ---------- */
    let toastTimer;
    const toast = (msg, type = "ok") => {
        const el = $("toast");
        el.textContent = msg;
        el.className = "toast " + (type === "error" ? "err" : type === "warning" ? "warn" : "ok");
        el.style.display = "block";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.style.display = "none"; }, 3000);
    };

    /* ---------- Confirm dialog (returns Promise) ---------- */
    const confirmDialog = (title, message, confirmLabel = "Confirm") => new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "overlay";
        overlay.innerHTML = `
            <div class="card modal" style="max-width:420px">
                <div class="modalhead"><h2>${esc(title)}</h2></div>
                <p class="muted" style="margin:8px 0 20px">${esc(message)}</p>
                <div class="actions">
                    <button class="secondary" type="button" data-cancel>Cancel</button>
                    <button class="primary" type="button" data-ok style="background:var(--danger)">${esc(confirmLabel)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = v => { overlay.remove(); resolve(v); };
        overlay.querySelector("[data-cancel]").onclick = () => close(false);
        overlay.querySelector("[data-ok]").onclick = () => close(true);
        overlay.onclick = e => { if (e.target === overlay) close(false); };
    });

    /* ---------- Tables ---------- */
    const emptyState = (title, msg) => `
        <tr><td colspan="20">
            <div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M4 6h16M4 12h16M4 18h10"/>
                </svg>
                <h4>${esc(title)}</h4>
                <p>${esc(msg)}</p>
            </div>
        </td></tr>`;

    const table = (heads, rows) => `
        <div class="tablewrap">
            <table>
                <thead><tr>${heads.map(x => `<th>${x}</th>`).join("")}</tr></thead>
                <tbody>${rows || `<tr><td colspan="${heads.length}" class="muted" style="text-align:center;padding:30px">No records.</td></tr>`}</tbody>
            </table>
        </div>`;

    /* ---------- Audit ---------- */
    const auditLog = async (action, entity, id, details = {}) => {
        if (db && user) {
            await db.from("audit_logs").insert({
                user_id: user.id, action, entity, entity_id: String(id), details
            });
        }
    };

    /* ---------- Login ---------- */
    $("loginForm").onsubmit = async e => {
        e.preventDefault();
        if (!db) {
            $("loginMsg").textContent = "Add Supabase credentials to config.js and run sql/schema.sql.";
            return;
        }
        const btn = e.target.querySelector("button[type=submit]");
        btn.disabled = true; btn.textContent = "Signing in…";
        const { data, error } = await db.auth.signInWithPassword({
            email: $("email").value.trim(),
            password: $("password").value
        });
        btn.disabled = false; btn.textContent = "Sign in";

        if (error) { $("loginMsg").textContent = error.message; return; }

        const { data: p } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        if (p?.role !== "admin") {
            await db.auth.signOut();
            $("loginMsg").textContent = "This account is not assigned administrator access.";
            return;
        }
        user = data.user;
        await start();
    };

    $("logout").onclick = async () => {
        if (db) await db.auth.signOut();
        location.reload();
    };

    /* ---------- Start ---------- */
    async function start() {
        $("login").classList.add("hidden");
        $("app").classList.remove("hidden");
        $("today").textContent = new Date().toLocaleDateString("en-GB", {
            weekday: "short", day: "2-digit", month: "short", year: "numeric"
        });
        await load();

        const s = JSON.parse(localStorage.getItem("company") || "{}");
        ["companyName", "companyAddress", "companyContact", "defaultCurrency"].forEach(k => {
            if (s[k]) $(k).value = s[k];
        });

        const first = new Date(); first.setDate(1);
        $("from").value = first.toISOString().slice(0, 10);
        $("to").value = new Date().toISOString().slice(0, 10);
    }

    if (db) {
        db.auth.getSession().then(async ({ data }) => {
            if (data.session) {
                const { data: p } = await db.from("profiles").select("role").eq("id", data.session.user.id).maybeSingle();
                if (p?.role === "admin") { user = data.session.user; start(); }
            }
        });
    } else {
        $("setup").classList.remove("hidden");
    }

    /* ---------- Load ---------- */
    async function load() {
        if (!db) return;
        const [r, c, i] = await Promise.all([
            db.from("transport_records").select("*").order("service_date", { ascending: false }),
            db.from("customers").select("*").order("name"),
            db.from("invoices").select("*").order("created_at", { ascending: false })
        ]);
        if (r.error || c.error || i.error) {
            toast((r.error || c.error || i.error).message, "error");
            return;
        }
        records = r.data || [];
        customers = c.data || [];
        invoices = i.data || [];

        dashboard();
        renderRecords();
        renderCustomers();
        renderInvoices();
        fillCustomers();
    }

    /* ---------- Navigation ---------- */
    document.querySelectorAll("[data-page]").forEach(b => {
        b.onclick = () => {
            document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
            $(b.dataset.page).classList.remove("hidden");
            document.querySelectorAll(".nav").forEach(n => n.classList.toggle("active", n === b));
            $("crumb").textContent = b.textContent.trim();
            $("title").textContent = b.textContent.trim();
            if (b.dataset.page === "reports") previewReport();
            if (b.dataset.page === "settings") loadAudit();
            window.scrollTo({ top: 0, behavior: "smooth" });
        };
    });

    /* ---------- Dashboard ---------- */
    function dashboard() {
        const total = records.reduce((s, r) => s + Number(r.quantity) * Number(r.rate), 0);
        const out = invoices
            .filter(i => !["Paid", "Void"].includes(i.status))
            .reduce((s, i) => s + Math.max(0, Number(i.total_amount) - Number(i.amount_paid)), 0);

        $("statRecords").textContent = records.length;
        $("statValue").textContent = money(total);
        $("statOutstanding").textContent = money(out);
        $("statPending").textContent = invoices.filter(i => i.status === "Pending Approval").length;

        $("recent").innerHTML = table(
            ["Date", "Description", "Customer", "Amount"],
            records.length
                ? records.slice(0, 8).map(r => `
                    <tr>
                        <td>${date(r.service_date)}</td>
                        <td>${esc(r.description)}${r.remarks ? `<small>${esc(r.remarks)}</small>` : ""}</td>
                        <td>${esc(name(r.customer_id))}</td>
                        <td><b>${money(r.quantity * r.rate, r.currency)}</b></td>
                    </tr>`).join("")
                : emptyState("No records yet", "Add your first transport record to see it here.")
        );
    }

    /* ---------- Records ---------- */
    function renderRecords() {
        const q = ($("recordSearch")?.value || "").toLowerCase();
        const from = $("recordFrom")?.value;
        const to = $("recordTo")?.value;
        const rs = records.filter(r =>
            (!q || `${r.description} ${r.remarks || ""} ${name(r.customer_id)}`.toLowerCase().includes(q)) &&
            (!from || r.service_date >= from) &&
            (!to || r.service_date <= to)
        );

        $("recordsTable").innerHTML = table(
            ["Date", "Description / remarks", "Customer", "Qty", "Rate", "Amount", "Actions"],
            rs.length
                ? rs.map(r => `
                    <tr>
                        <td>${date(r.service_date)}</td>
                        <td><b>${esc(r.description)}</b>${r.remarks ? `<small>${esc(r.remarks)}</small>` : ""}</td>
                        <td>${esc(name(r.customer_id))}</td>
                        <td>${r.quantity}</td>
                        <td>${money(r.rate, r.currency)}</td>
                        <td><b>${money(r.quantity * r.rate, r.currency)}</b></td>
                        <td>
                            <button class="rowbtn" onclick="editRecord('${r.id}')">Edit</button>
                            <button class="rowbtn danger" onclick="deleteRecord('${r.id}')">Delete</button>
                        </td>
                    </tr>`).join("")
                : emptyState("No records match", "Adjust your filters or add a new record.")
        );
    }

    /* ---------- Customers ---------- */
    function renderCustomers() {
        $("customersTable").innerHTML = table(
            ["Customer", "Contact", "Email", "Phone", "Actions"],
            customers.length
                ? customers.map(c => `
                    <tr>
                        <td><b>${esc(c.name)}</b>${c.billing_address ? `<small>${esc(c.billing_address)}</small>` : ""}</td>
                        <td>${esc(c.contact_person || "—")}</td>
                        <td>${esc(c.email || "—")}</td>
                        <td>${esc(c.phone || "—")}</td>
                        <td>
                            <button class="rowbtn" onclick="editCustomer('${c.id}')">Edit</button>
                            <button class="rowbtn danger" onclick="deleteCustomer('${c.id}')">Delete</button>
                        </td>
                    </tr>`).join("")
                : emptyState("No customers yet", "Add your first customer to start creating invoices.")
        );
    }

    /* ---------- Invoices ---------- */
    function statusClass(s) {
        if (s === "Paid" || s === "Approved") return "ok";
        if (s === "Pending Approval") return "warn";
        if (s === "Void") return "bad";
        if (s === "Sent" || s === "Partially Paid") return "info";
        return "";
    }

    function renderInvoices() {
        $("invoicesTable").innerHTML = table(
            ["Invoice", "Customer / period", "Total", "Paid", "Balance", "Status", "Actions"],
            invoices.length
                ? invoices.map(i => `
                    <tr>
                        <td><b>${esc(i.invoice_number)}</b><small>${date(i.invoice_date)}</small></td>
                        <td>${esc(name(i.customer_id))}<small>${date(i.period_start)} – ${date(i.period_end)}</small></td>
                        <td>${money(i.total_amount, i.currency)}</td>
                        <td>${money(i.amount_paid, i.currency)}</td>
                        <td><b>${money(Math.max(0, i.total_amount - i.amount_paid), i.currency)}</b></td>
                        <td><span class="status ${statusClass(i.status)}">${esc(i.status)}</span></td>
                        <td><button class="rowbtn" onclick="editInvoice('${i.id}')">Edit</button></td>
                    </tr>`).join("")
                : emptyState("No invoices yet", "Create your first invoice from the button above.")
        );
    }

    /* ---------- Customer select ---------- */
    function fillCustomers() {
        const opts = customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
        $("reportCustomer").innerHTML = '<option value="">All customers</option>' + opts;
    }

    /* ---------- Field builders ---------- */
    function field(label, name, value = "", kind = "text", wide = false, extra = "") {
        return `<label class="${wide ? "wide" : ""}">${label}
            <input name="${name}" type="${kind}" value="${esc(value)}" ${extra}></label>`;
    }
    function select(label, name, options, value, wide = false) {
        return `<label class="${wide ? "wide" : ""}">${label}
            <select name="${name}">${options.map(o =>
                `<option value="${esc(o[0])}" ${String(o[0]) === String(value) ? "selected" : ""}>${esc(o[1])}</option>`
            ).join("")}</select></label>`;
    }

    /* ---------- Open modal ---------- */
    function open(typeName, row = null) {
        type = typeName;
        edit = row?.id || null;
        let html = "";
        let title = "";

        if (type === "record") {
            title = row ? "Edit transport record" : "Add transport record";
            html =
                field("Service date", "service_date", row?.service_date || new Date().toISOString().slice(0, 10), "date") +
                select("Customer", "customer_id",
                    [["", "Unassigned"], ...customers.map(c => [c.id, c.name])],
                    row?.customer_id || "") +
                field("Description", "description", row?.description || "", "text", true,
                    'required placeholder="e.g. 3-Ton truck — pickup and delivery"') +
                field("Quantity", "quantity", row?.quantity ?? 1, "number", false, 'required min="0.001" step="0.001"') +
                field("Rate", "rate", row?.rate ?? 0, "number", false, 'required min="0" step="0.01"') +
                select("Currency", "currency", ["AED","USD","EUR","GBP","SAR","PKR"].map(x => [x, x]), row?.currency || "AED") +
                field("Remarks", "remarks", row?.remarks || "", "text", true);

        } else if (type === "customer") {
            title = row ? "Edit customer" : "Add customer";
            html =
                field("Customer / company name", "name", row?.name || "", "text", true, "required") +
                field("Contact person", "contact_person", row?.contact_person || "") +
                field("Email", "email", row?.email || "", "email") +
                field("Phone", "phone", row?.phone || "", "tel") +
                field("Billing address", "billing_address", row?.billing_address || "", "text", true) +
                field("Tax / registration number", "tax_number", row?.tax_number || "", "text", true);

        } else {
            title = row ? "Edit invoice" : "Create invoice";
            html =
                field("Invoice number", "invoice_number",
                    row?.invoice_number ||
                        `MSJ-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(3, "0")}`,
                    "text", false, "required") +
                select("Customer", "customer_id", customers.map(c => [c.id, c.name]), row?.customer_id || "") +
                field("Invoice date", "invoice_date", row?.invoice_date || new Date().toISOString().slice(0, 10), "date") +
                field("Period start", "period_start", row?.period_start || new Date().toISOString().slice(0, 10), "date") +
                field("Period end", "period_end", row?.period_end || new Date().toISOString().slice(0, 10), "date") +
                select("Currency", "currency", ["AED","USD","EUR","GBP","SAR","PKR"].map(x => [x, x]), row?.currency || "AED") +
                field("Total amount", "total_amount", row?.total_amount ?? 0, "number", false, 'min="0" step=".01" required') +
                field("Amount paid", "amount_paid", row?.amount_paid ?? 0, "number", false, 'min="0" step=".01" required') +
                select("Status", "status",
                    ["Draft","Pending Approval","Approved","Sent","Partially Paid","Paid","Void"].map(x => [x, x]),
                    row?.status || "Draft", true) +
                field("Notes", "notes", row?.notes || "", "text", true);
        }

        $("modalTitle").textContent = title;
        $("fields").innerHTML = html;
        $("modal").classList.remove("hidden");

        $("modalForm").onsubmit = async e => {
            e.preventDefault();
            if (!db) { toast("Connect Supabase first.", "error"); return; }

            const btn = e.target.querySelector("button[type=submit]");
            btn.disabled = true; btn.textContent = "Saving…";

            const d = Object.fromEntries(new FormData(e.target).entries());
            const tableName = type === "record" ? "transport_records" : type === "customer" ? "customers" : "invoices";

            if (type === "record") {
                d.quantity = Number(d.quantity);
                d.rate = Number(d.rate);
                d.customer_id = d.customer_id || null;
            }
            if (type === "invoice") {
                d.total_amount = Number(d.total_amount);
                d.amount_paid = Number(d.amount_paid);
                d.customer_id = d.customer_id || null;
                if (d.amount_paid >= d.total_amount && d.total_amount > 0) d.status = "Paid";
                else if (d.amount_paid > 0 && d.status === "Sent") d.status = "Partially Paid";
            }

            const res = edit
                ? await db.from(tableName).update(d).eq("id", edit).select().single()
                : await db.from(tableName).insert(d).select().single();

            btn.disabled = false; btn.textContent = "Save";

            if (res.error) { toast(res.error.message, "error"); return; }
            await auditLog(edit ? "update" : "create", tableName, res.data.id, { fields: Object.keys(d) });
            closeModal();
            await load();
            toast("Saved successfully");
        };
    }

    window.openRecord = () => open("record");
    window.openCustomer = () => open("customer");
    window.openInvoice = () => open("invoice");
    window.editRecord = id => open("record", records.find(r => r.id === id));
    window.editCustomer = id => open("customer", customers.find(r => r.id === id));
    window.editInvoice = id => open("invoice", invoices.find(r => r.id === id));

    window.deleteRecord = async id => {
        if (!await confirmDialog("Delete transport record", "This permanently removes the record from the ledger. Continue?", "Delete")) return;
        const { error } = await db.from("transport_records").delete().eq("id", id);
        if (error) return toast(error.message, "error");
        await auditLog("delete", "transport_records", id);
        await load();
        toast("Record deleted");
    };

    window.deleteCustomer = async id => {
        if (!await confirmDialog("Delete customer", "Linked records and invoices may prevent deletion. Continue?", "Delete")) return;
        const { error } = await db.from("customers").delete().eq("id", id);
        if (error) return toast(error.message, "error");
        await auditLog("delete", "customers", id);
        await load();
        toast("Customer deleted");
    };

    function closeModal() { $("modal").classList.add("hidden"); }
    window.closeModal = closeModal;

    /* ---------- Reports ---------- */
    function reportRows() {
        const f = $("from").value, t = $("to").value, c = $("reportCustomer").value;
        return records.filter(r =>
            (!f || r.service_date >= f) &&
            (!t || r.service_date <= t) &&
            (!c || r.customer_id === c)
        );
    }

    window.previewReport = () => {
        const rs = reportRows();
        const total = rs.reduce((s, r) => s + Number(r.quantity) * Number(r.rate), 0);
        $("preview").innerHTML =
            `<p style="margin:0 0 12px;color:var(--ink-2)">
                <b>${rs.length}</b> records · <b>${money(total, $("currency").value)}</b>
            </p>` +
            table(
                ["Date", "Description", "Qty", "Rate", "Amount"],
                rs.length
                    ? rs.map(r => `
                        <tr>
                            <td>${date(r.service_date)}</td>
                            <td>${esc(r.description)}</td>
                            <td>${r.quantity}</td>
                            <td>${money(r.rate, r.currency)}</td>
                            <td><b>${money(r.quantity * r.rate, r.currency)}</b></td>
                        </tr>`).join("")
                    : `<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No records in this range.</td></tr>`
            );
    };

    /* ---------- PDF ---------- */
    window.makePDF = () => {
        const rs = reportRows();
        if (!rs.length) return toast("No matching records to export.", "warning");
        if (!window.jspdf) return toast("PDF library failed to load.", "error");

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const company = $("companyName").value || "MSJ Transport L.L.C";
        const cur = $("currency").value;
        const total = rs.reduce((s, r) => s + Number(r.quantity) * Number(r.rate), 0);

        /* Header band */
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, 297, 26, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(17); doc.setFont("helvetica", "bold");
        doc.text(company, 14, 12);
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text(
            $("reportType").value === "invoice" ? "TRANSPORT INVOICE" : "TRANSPORT SERVICE REPORT",
            14, 20
        );
        doc.setFontSize(9);
        doc.text(
            `${$("reportCustomer").selectedOptions[0]?.text || "All customers"}  ·  ${date($("from").value)} — ${date($("to").value)}`,
            283, 20, { align: "right" }
        );

        /* Meta block */
        doc.setTextColor(30, 45, 58);
        doc.setFontSize(9.5);
        let yy = 36;
        if ($("companyAddress").value) {
            doc.text(`Address: ${$("companyAddress").value}`, 14, yy); yy += 5;
        }
        if ($("companyContact").value) {
            doc.text(`Contact: ${$("companyContact").value}`, 14, yy); yy += 5;
        }
        if ($("reportType").value === "invoice" && $("invoiceNo").value) {
            doc.text(`Invoice No: ${$("invoiceNo").value}`, 283, 36, { align: "right" });
        }

        /* Table */
        const body = rs.map(r => [
            date(r.service_date),
            r.description,
            String(r.quantity),
            Number(r.rate).toFixed(2),
            (Number(r.quantity) * Number(r.rate)).toFixed(2),
            r.remarks || ""
        ]);
        body.push([
            { content: `TOTAL (${cur})`, colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
            "", "", total.toFixed(2), ""
        ]);

        doc.autoTable({
            head: [["Date", "Description", "Qty", `Rate (${cur})`, `Amount (${cur})`, "Remarks"]],
            body,
            startY: yy + 4,
            theme: "grid",
            styles: { fontSize: 8.5, cellPadding: 3, overflow: "linebreak", textColor: [30, 45, 58] },
            headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [248, 250, 253] },
            columnStyles: {
                0: { cellWidth: 26 }, 1: { cellWidth: 100 }, 2: { cellWidth: 16, halign: "right" },
                3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 32, halign: "right" }
            },
            didParseCell: d => {
                if (d.row.index === body.length - 1) {
                    d.cell.styles.fillColor = [37, 99, 235];
                    d.cell.styles.textColor = 255;
                    d.cell.styles.fontStyle = "bold";
                }
            }
        });

        /* Footer */
        doc.setFontSize(8);
        doc.setTextColor(120, 130, 150);
        doc.text(
            "Prepared for review and approval. Verify service details and rates before issuing.",
            14, Math.min(doc.lastAutoTable.finalY + 8, 200)
        );
        doc.text(
            `Generated ${new Date().toLocaleString()}`,
            283, Math.min(doc.lastAutoTable.finalY + 8, 200), { align: "right" }
        );

        doc.save(`Transport_${$("from").value || "start"}_${$("to").value || "end"}.pdf`);
        toast("PDF generated");
    };

    /* ---------- Settings ---------- */
    window.saveSettings = () => {
        const s = {};
        ["companyName", "companyAddress", "companyContact", "defaultCurrency"].forEach(k => s[k] = $(k).value);
        localStorage.setItem("company", JSON.stringify(s));
        toast("Settings saved");
    };

    /* ---------- Audit ---------- */
    window.loadAudit = async () => {
        if (!db) return;
        const { data, error } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(50);
        $("auditTable").innerHTML = error
            ? `<p class="muted">${esc(error.message)}</p>`
            : table(
                ["When", "Action", "Entity", "Details"],
                (data || []).length
                    ? data.map(a => `
                        <tr>
                            <td>${date(a.created_at.slice(0, 10))}</td>
                            <td><span class="status">${esc(a.action)}</span></td>
                            <td>${esc(a.entity)}</td>
                            <td><small>${esc(JSON.stringify(a.details || {}))}</small></td>
                        </tr>`).join("")
                    : emptyState("No activity yet", "Actions performed by admins will appear here.")
            );
    };

    /* ---------- Filters ---------- */
    $("recordSearch").oninput = renderRecords;
    $("recordFrom").onchange = renderRecords;
    $("recordTo").onchange = renderRecords;
    $("reportCustomer").onchange = previewReport;
    $("currency").onchange = previewReport;
})();
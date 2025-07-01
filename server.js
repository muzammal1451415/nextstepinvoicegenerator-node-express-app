const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const Datastore = require('nedb'); // Import NeDB

const app = express();
const port = 3000;

// Initialize NeDB databases
// Invoices database: stores all tax invoices
const invoicesDb = new Datastore({ filename: path.join(__dirname, 'data/invoices.db'), autoload: true });
// Counter database: stores the last sequential invoice number
const countersDb = new Datastore({ filename: path.join(__dirname, 'data/counters.db'), autoload: true });

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Use body-parser to parse form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Helper to get the next sequential invoice number
async function getNextInvoiceNumber() {
    return new Promise((resolve, reject) => {
        countersDb.findOne({ _id: 'invoiceCounter' }, (err, doc) => {
            if (err) {
                console.error("Error finding invoice counter:", err);
                // Fallback to a random number if there's a database error
                return reject(`INV-${Math.floor(10000 + Math.random() * 90000)}`);
            }

            let nextNumber = 1;
            if (doc) {
                // If counter exists, increment it
                nextNumber = (doc.lastInvoiceNumber || 0) + 1;
                countersDb.update({ _id: 'invoiceCounter' }, { $set: { lastInvoiceNumber: nextNumber } }, {}, (updateErr) => {
                    if (updateErr) console.error("Error updating invoice counter:", updateErr);
                    resolve(`INV-${nextNumber.toString().padStart(5, '0')}`);
                });
            } else {
                // If counter doesn't exist, create it
                countersDb.insert({ _id: 'invoiceCounter', lastInvoiceNumber: nextNumber }, (insertErr) => {
                    if (insertErr) console.error("Error inserting invoice counter:", insertErr);
                    resolve(`INV-${nextNumber.toString().padStart(5, '0')}`);
                });
            }
        });
    });
}

// Function to read HTML template and replace placeholders
async function renderHtmlTemplate(templatePath, data = {}) {
    let html = fs.readFileSync(templatePath, 'utf8');

    // Replace general placeholders
    for (const key in data) {
        // Handle initialItemRows specifically as it's raw HTML, not plain string/number
        // This uses triple braces in the template ({{{key}}}) to prevent HTML escaping
        if (key === 'initialItemRows') {
            html = html.replace(new RegExp(`{{{${key}}}}`, 'g'), data[key]);
        } else if (typeof data[key] === 'string' || typeof data[key] === 'number') {
            // Replace other placeholders using double braces ({{key}})
            html = html.replace(new RegExp(`{{${key}}}`, 'g'), data[key]);
        }
    }
    return html;
}

// --- Routes ---

// Main navigation page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Route to serve the invoice input form (Estimates)
app.get('/generate-estimate-form', async (req, res) => {
    const currentDate = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
    const newInvoiceNum = `EST-${Math.floor(10000 + Math.random() * 90000)}`; // Random for estimates

    let html = await renderHtmlTemplate(path.join(__dirname, 'invoice_form_template.html'), {
        formTitle: 'Generate Tax Invoice Estimates',
        arabicFormTitle: 'إنشاء تقديرات فاتورة ضريبية',
        formAction: '/generate-invoice', // This will be the POST endpoint for estimates
        newInvoiceNum: newInvoiceNum,
        currentDate: currentDate,
        // Default values for form fields to pre-populate the form
        customerName: 'Mr. Muzammal Abdul Ghafoor',
        customerPhone: '0526626675',
        customerAddress: 'Dubai, United Arab Emirates',
        createdBy: 'Noreen Ali',
        vehicleMakeModel: 'Nissan Patrol 2015',
        vehicleVIN: '2393923923929399',
        vehicleReg: 'D-32342',
        vehicleMileage: '238283',
        receivedBy: 'Asif Ali',
        // Initial item rows (example data for the form)
        initialItemRows: `
            <div class="item-row">
                <input type="hidden" name="items[0][id]" value="1">
                <div class="flex items-center justify-center">1</div>
                <input type="text" name="items[0][description]" placeholder="Item Description" value="AC Compressor" required>
                <input type="number" name="items[0][qty]" placeholder="Qty" value="1" min="1" required oninput="updateTotals()">
                <input type="number" name="items[0][unitPrice]" placeholder="Unit Price" value="100" min="0" step="0.01" required oninput="updateTotals()">
                <input type="number" name="items[0][vatPercent]" placeholder="VAT%" value="5" min="0" step="0.01" required oninput="updateTotals()">
                <div class="flex items-center justify-center">AED <span class="vat-amount">5.00</span></div>
                <div class="flex items-center justify-center">AED <span class="total-amount">105.00</span></div>
                <button type="button" class="delete-item-btn" onclick="deleteItem(this)">Delete</button>
            </div>
            <div class="item-row">
                <input type="hidden" name="items[1][id]" value="2">
                <div class="flex items-center justify-center">2</div>
                <input type="text" name="items[1][description]" placeholder="Item Description" value="Oil Change" required>
                <input type="number" name="items[1][qty]" placeholder="Qty" value="1" min="1" required oninput="updateTotals()">
                <input type="number" name="items[1][unitPrice]" placeholder="Unit Price" value="200" min="0" step="0.01" required oninput="updateTotals()">
                <input type="number" name="items[1][vatPercent]" placeholder="VAT%" value="5" min="0" step="0.01" required oninput="updateTotals()">
                <div class="flex items-center justify-center">AED <span class="vat-amount">10.00</span></div>
                <div class="flex items-center justify-center">AED <span class="total-amount">210.00</span></div>
                <button type="button" class="delete-item-btn" onclick="deleteItem(this)">Delete</button>
            </div>
        `
    });
    res.send(html);
});

// Route to serve the invoice input form (Tax Invoice - sequential numbering & history)
app.get('/generate-invoice-form', async (req, res) => {
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const newInvoiceNum = await getNextInvoiceNumber(); // Sequential for tax invoices

    let html = await renderHtmlTemplate(path.join(__dirname, 'invoice_form_template.html'), {
        formTitle: 'Generate Tax Invoice',
        arabicFormTitle: 'إنشاء فاتورة ضريبية',
        formAction: '/generate-tax-invoice', // This will be the POST endpoint for tax invoices
        newInvoiceNum: newInvoiceNum,
        currentDate: currentDate,
        // Default values for form fields to pre-populate the form
        customerName: 'Mr. Muzammal Abdul Ghafoor',
        customerPhone: '0526626675',
        customerAddress: 'Dubai, United Arab Emirates',
        createdBy: 'Noreen Ali',
        vehicleMakeModel: 'Nissan Patrol 2015',
        vehicleVIN: '2393923923929399',
        vehicleReg: 'D-32342',
        vehicleMileage: '238283',
        receivedBy: 'Asif Ali',
        // Initial item rows (example data for the form)
        initialItemRows: `
            <div class="item-row">
                <input type="hidden" name="items[0][id]" value="1">
                <div class="flex items-center justify-center">1</div>
                <input type="text" name="items[0][description]" placeholder="Item Description" value="AC Compressor" required>
                <input type="number" name="items[0][qty]" placeholder="Qty" value="1" min="1" required oninput="updateTotals()">
                <input type="number" name="items[0][unitPrice]" placeholder="Unit Price" value="100" min="0" step="0.01" required oninput="updateTotals()">
                <input type="number" name="items[0][vatPercent]" placeholder="VAT%" value="5" min="0" step="0.01" required oninput="updateTotals()">
                <div class="flex items-center justify-center">AED <span class="vat-amount">5.00</span></div>
                <div class="flex items-center justify-center">AED <span class="total-amount">105.00</span></div>
                <button type="button" class="delete-item-btn" onclick="deleteItem(this)">Delete</button>
            </div>
            <div class="item-row">
                <input type="hidden" name="items[1][id]" value="2">
                <div class="flex items-center justify-center">2</div>
                <input type="text" name="items[1][description]" placeholder="Item Description" value="Oil Change" required>
                <input type="number" name="items[1][qty]" placeholder="Qty" value="1" min="1" required oninput="updateTotals()">
                <input type="number" name="items[1][unitPrice]" placeholder="Unit Price" value="200" min="0" step="0.01" required oninput="updateTotals()">
                <input type="number" name="items[1][vatPercent]" placeholder="VAT%" value="5" min="0" step="0.01" required oninput="updateTotals()">
                <div class="flex items-center justify-center">AED <span class="vat-amount">10.00</span></div>
                <div class="flex items-center justify-center">AED <span class="total-amount">210.00</span></div>
                <button type="button" class="delete-item-btn" onclick="deleteItem(this)">Delete</button>
            </div>
        `
    });
    res.send(html);
});


// Route to generate the PDF invoice for Estimates (no history storage)
app.post('/generate-invoice', async (req, res) => {
    const invoiceData = req.body;
    invoiceData.type = 'estimate'; // Mark as estimate

    await generateAndSendPdf(invoiceData, res);
});

// Route to generate the PDF invoice for Tax Invoices (with history storage)
app.post('/generate-tax-invoice', async (req, res) => {
    const invoiceData = req.body;
    invoiceData.type = 'tax_invoice'; // Mark as tax invoice

    // Save invoice data to NeDB
    invoicesDb.insert(invoiceData, (err, newDoc) => {
        if (err) {
            console.error("Error saving invoice to NeDB:", err);
            // Continue to generate PDF even if saving fails
        } else {
            console.log(`Tax Invoice ${invoiceData.invoiceNumber} saved to history with _id: ${newDoc._id}`);
        }
    });

    await generateAndSendPdf(invoiceData, res);
});

// Function to handle PDF generation and sending
async function generateAndSendPdf(invoiceData, res) {
    // Read the HTML template
    let htmlContent = fs.readFileSync(path.join(__dirname, 'invoice_template.html'), 'utf8');

    // Determine the main title based on invoice type
    const mainTitle = invoiceData.type === 'tax_invoice' ? 'TAX INVOICE' : 'TAX INVOICE ESTIMATES';
    const arabicMainTitle = invoiceData.type === 'tax_invoice' ? 'فاتورة ضريبية' : 'تقديرات فواتير الضرائب';

    htmlContent = htmlContent.replace('{{mainTitle}}', mainTitle);
    htmlContent = htmlContent.replace('{{arabicMainTitle}}', arabicMainTitle);

    // Replace placeholders with dynamic data
    htmlContent = htmlContent.replace('{{customerName}}', invoiceData.customerName || '');
    htmlContent = htmlContent.replace('{{customerPhone}}', invoiceData.customerPhone || '');
    htmlContent = htmlContent.replace('{{customerAddress}}', invoiceData.customerAddress || '');
    htmlContent = htmlContent.replace('{{invoiceNumber}}', invoiceData.invoiceNumber || '');
    htmlContent = htmlContent.replace('{{createdAt}}', invoiceData.createdAt || '');
    htmlContent = htmlContent.replace('{{createdBy}}', invoiceData.createdBy || '');
    htmlContent = htmlContent.replace('{{vehicleMakeModel}}', invoiceData.vehicleMakeModel || '');
    htmlContent = htmlContent.replace('{{vehicleVIN}}', invoiceData.vehicleVIN || '');
    htmlContent = htmlContent.replace('{{vehicleReg}}', invoiceData.vehicleReg || '');
    htmlContent = htmlContent.replace('{{vehicleMileage}}', invoiceData.vehicleMileage || '');
    htmlContent = htmlContent.replace('{{receivedBy}}', invoiceData.receivedBy || '');
    htmlContent = htmlContent.replace('{{receivedOn}}', invoiceData.receivedOn || '');

    // Generate item rows dynamically
    let itemRowsHtml = '';
    // Ensure items is an array, even if only one item is submitted (body-parser might make it an object)
    const items = Array.isArray(invoiceData.items) ? invoiceData.items : (invoiceData.items ? [invoiceData.items] : []);

    if (items.length > 0) {
        items.forEach((item, index) => {
            const qty = parseFloat(item.qty) || 0;
            const unitPrice = parseFloat(item.unitPrice) || 0;
            const vatPercent = parseFloat(item.vatPercent) || 0;

            const itemSubtotal = qty * unitPrice;
            const itemVatAmount = itemSubtotal * (vatPercent / 100);
            const itemTotal = itemSubtotal + itemVatAmount;

            itemRowsHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.description || ''}</td>
                    <td>${qty}</td>
                    <td>${unitPrice.toFixed(2)}</td>
                    <td>${vatPercent.toFixed(2)}</td>
                    <td>${itemVatAmount.toFixed(2)}</td>
                    <td>${itemTotal.toFixed(2)}</td>
                </tr>
            `;
        });
    } else {
        itemRowsHtml = '<tr><td colspan="7">No items listed.</td></tr>';
    }
    htmlContent = htmlContent.replace('{{itemRows}}', itemRowsHtml);

    // Replace summary totals
    htmlContent = htmlContent.replace('{{goodsTotal}}', (parseFloat(invoiceData.goodsTotal) || 0).toFixed(2));
    htmlContent = htmlContent.replace('{{vatTotal}}', (parseFloat(invoiceData.vatTotal) || 0).toFixed(2));
    htmlContent = htmlContent.replace('{{discountPercent}}', (parseFloat(invoiceData.discountPercent) || 0).toFixed(2));
    htmlContent = htmlContent.replace('{{discountAmount}}', (parseFloat(invoiceData.discountAmount) || 0).toFixed(2));
    htmlContent = htmlContent.replace('{{grandTotal}}', (parseFloat(invoiceData.grandTotal) || 0).toFixed(2));

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Set the content of the page
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0'
        });

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${invoiceData.type}-${invoiceData.invoiceNumber || 'generated'}.pdf`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Error generating PDF invoice.');
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Route to serve the invoice history page
app.get('/invoice-history', (req, res) => {
    res.sendFile(path.join(__dirname, 'invoice_history.html'));
});

// API endpoint to fetch invoice history
app.get('/api/invoices', async (req, res) => {
    const { startDate, endDate, customerName, customerPhone } = req.query;

    let query = { type: 'tax_invoice' }; // Only show Tax Invoices

    if (startDate) {
        query.createdAt = { $gte: startDate };
    }
    if (endDate) {
        query.createdAt = { ...query.createdAt, $lte: endDate };
    }
    // NeDB supports regex for partial string matching
    if (customerName) {
        query.customerName = new RegExp(customerName, 'i'); // 'i' for case-insensitive
    }
    if (customerPhone) {
        query.customerPhone = new RegExp(customerPhone, 'i'); // 'i' for case-insensitive
    }

    invoicesDb.find(query).sort({ createdAt: -1 }).exec((err, docs) => {
        if (err) {
            console.error("Error fetching invoices from NeDB:", err);
            return res.status(500).json({ error: "Failed to fetch invoice history." });
        }
        res.json(docs);
    });
});

// Route to view/download a specific invoice PDF from history
app.get('/download-invoice/:id', async (req, res) => {
    const invoiceId = req.params.id;

    invoicesDb.findOne({ _id: invoiceId }, async (err, invoiceData) => {
        if (err) {
            console.error(`Error finding invoice ${invoiceId} in NeDB:`, err);
            return res.status(500).send('Error retrieving invoice for download.');
        }
        if (!invoiceData) {
            return res.status(404).send('Invoice not found.');
        }
        await generateAndSendPdf(invoiceData, res); // Reuse PDF generation function
    });
});


// Start the server
app.listen(port, () => {
    console.log(`Invoice generator app listening at http://localhost:${port}`);
});

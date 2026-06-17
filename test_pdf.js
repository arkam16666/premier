const payload = {
  "id": "PR-6906-0001",
  "orderDate": "17/6/2569",
  "grandTotal": 9801.2,
  "vat": 641.2,
  "title": "ใบสั่งซื้อ",
  "title_eng": "Purchase Requisition",
  "customerCode": "PR004",
  "contactName": "",
  "vendorName": "100Thai.com Accessories",
  "vendorAddress": "12/90 อาคารเสรีเซ็นเตอร์ ชั้น 2 หมู่ 6  ถนนศรีนครินทร์ แขวงหนองบอน เขตประเวศ จังหวัดกรุงเทพฯ 10260",
  "vendorPhone": "02-688-2347",
  "deliveryDate": "2026-04-23",
  "creditDays": "",
  "paymentTerms": "เครดิต",
  "picName": "กรรนิการ์ นิ่มฟัก",
  "picDepartment": "Procurement Dept.",
  "items": [{"sku":"p2401-001","productName":"เสื้อยืดคอกลม","qty":"5","unitPrice":"150","total":"750"},{"sku":"p0103-010","productName":"เสื้อกันหนาว","qty":"10","unitPrice":"400","total":"4000"}]
};

fetch('https://pdf.thanadon.click/api/generate-pdf/po', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(r => {
  console.log('Status:', r.status);
  return r.text();
})
.then(t => console.log('Body length:', t.length, 'Preview:', t.substring(0, 100)))
.catch(e => console.error('Error:', e));

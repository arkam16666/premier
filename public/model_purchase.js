// เปิด Modal
function openModal() {
    var modal = document.getElementById('productModal');
    modal.classList.add('show');

    // รีเซ็ตช่องค้นหา
    var searchInput = document.getElementById('productSearch');
    if (searchInput) searchInput.value = '';

    // แสดงทุกแถว + เล่น animation ใหม่
    var rows = document.querySelectorAll('.product-row');
    rows.forEach(function(row, index) {
        row.classList.remove('hidden');
        row.style.animation = 'none';
        row.offsetHeight;
        row.style.animation = 'rowIn 0.35s ease forwards';
        row.style.animationDelay = (index * 0.04) + 's';
    });

    updateSelectedCount();
}

// ปิด Modal
function closeModal() {
    var modal = document.getElementById('productModal');
    var panel = modal.querySelector('.modal-panel');

    panel.classList.add('closing');

    setTimeout(function() {
        modal.classList.remove('show');
        panel.classList.remove('closing');

        // รีเซ็ต checkbox และจำนวน
        document.querySelectorAll('.product-checkbox').forEach(function(cb) {
            cb.checked = false;
        });
        document.querySelectorAll('.product-qty').forEach(function(input) {
            input.value = '0';
        });
        document.querySelectorAll('.product-row').forEach(function(row) {
            row.style.background = '';
        });

        updateSelectedCount();
    }, 300);
}

// ค้นหาสินค้า
document.getElementById('productSearch')?.addEventListener('keyup', function(e) {
    var searchTerm = e.target.value.toLowerCase().trim();
    var rows = document.querySelectorAll('.product-row');

    rows.forEach(function(row) {
        var cells = row.querySelectorAll('td');
        var text = Array.from(cells).map(function(td) {
            return td.textContent.toLowerCase();
        }).join(' ');

        if (text.includes(searchTerm) || searchTerm === '') {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
});

// อัพเดตจำนวนที่เลือก
function updateSelectedCount() {
    var checked = document.querySelectorAll('.product-checkbox:checked').length;
    var countEl = document.getElementById('selectedCount');
    if (countEl) {
        countEl.textContent = 'เลือก ' + checked + ' รายการ';
    }
}

// ฟังก์ชันคำนวณใหม่เมื่อมีการเปลี่ยนจำนวน
function recalculateTotals() {
    var rows = document.querySelectorAll('.item-row');
    var grandTotal = 0;
    var itemCount = 0;

    rows.forEach(function(row) {
        if (row.style.display === 'none') return;

        var productCode = row.getAttribute('data-product');
        var qtyInput = row.querySelector('.item-qty');
        var qty = parseFloat(qtyInput.value) || 0;
        
        if (qty > 0) itemCount++;

        var productInfo = allProducts.find(p => p['รหัส'] === productCode);
        if (productInfo) {
            var price = Math.max(0, parseFloat(productInfo['ราคาซื้อ']) || 0);
            var amount = price * qty;
            var taxRateStr = (productInfo['อัตราภาษีซื้อ'] || "0").toString().replace('%', '');
            var taxRate = Math.max(0, parseFloat(taxRateStr) || 0);
            var tax = amount * (taxRate / 100);
            var total = amount + tax;

            // Update row cells
            row.cells[7].textContent = amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            row.cells[8].textContent = tax.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            row.cells[9].textContent = total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            
            grandTotal += total;
        }
    });

    // Update Summary Cards
    var summaryTotalEl = document.getElementById('summaryGrandTotal');
    var summaryCountEl = document.getElementById('summaryItemCount');
    
    if (summaryTotalEl) summaryTotalEl.textContent = '฿' + grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (summaryCountEl) summaryCountEl.textContent = itemCount + ' รายการ';
}

// ผูกเหตุการณ์เมื่อเปลี่ยนจำนวนในตาราง
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('item-qty')) {
        recalculateTotals();
    }
});

// คำนวณยอดรวมเมื่อโหลดหน้าเว็บเสร็จ
document.addEventListener('DOMContentLoaded', function() {
    // recalculateTotals(); // เอาออกเพื่อให้ดึงจาก DB ตรงๆ ในตอนแรก
});

// ไฮไลท์แถวเมื่อเลือก checkbox
document.addEventListener('change', function(e) {
    if (!e.target.classList.contains('product-checkbox')) return;

    updateSelectedCount();

    var row = e.target.closest('tr');
    if (e.target.checked) {
        row.style.background = 'rgba(255, 126, 179, 0.08)'; // Pink theme
    } else {
        row.style.background = '';
    }
});

// เพิ่มสินค้าที่เลือก (Updated for Purchase)
function addSelectedProducts() {
    var rows = document.querySelectorAll('.modal-table tbody tr');
    var selectedProducts = [];
    var tableBody = document.getElementById('purchasePrBody'); // Changed from salePrBody

    rows.forEach(function(row) {
        var checkbox = row.querySelector('.product-checkbox');
        var qtyInput = row.querySelector('.product-qty');

        if (checkbox && checkbox.checked && qtyInput && parseFloat(qtyInput.value) > 0) {
            var productCode = checkbox.value;
            var fullProduct = allProducts.find(p => p['รหัส'] === productCode);
            
            if (fullProduct) {
                var qtyToAdd = parseFloat(qtyInput.value);
                
                // Check if product already exists in the table
                var existingRow = document.querySelector(`#purchasePrBody tr[data-product="${productCode}"]`);
                
                if (existingRow) {
                    // Update existing quantity
                    var qtyInputInTable = existingRow.querySelector('.item-qty');
                    var currentQty = parseFloat(qtyInputInTable.value) || 0;
                    qtyInputInTable.value = currentQty + qtyToAdd;
                    
                    // Show row if it was hidden (soft-deleted)
                    existingRow.style.display = '';
                    existingRow.classList.add('pending-add');
                } else {
                    // Create a new row with editable input AND checkbox
                    var newRow = document.createElement('tr');
                    newRow.className = 'item-row pending-add';
                    newRow.setAttribute('data-product', productCode);
                    
                    var price = Math.max(0, parseFloat(fullProduct['ราคาซื้อ']) || 0); // Changed from ราคาขาย
                    var amount = price * qtyToAdd;
                    var taxRateStr = (fullProduct['อัตราภาษีซื้อ'] || "0").toString().replace('%', ''); // Changed from อัตราภาษีขาย
                    var taxRate = Math.max(0, parseFloat(taxRateStr) || 0);
                    var tax = amount * (taxRate / 100);
                    var total = amount + tax;

                    newRow.innerHTML = `
                        <td class="text-center">
                            <input type="checkbox" class="item-checkbox">
                        </td>
                        <td>${productCode}</td>
                        <td>${fullProduct['ชื่อ'] || ''}</td>
                        <td>${fullProduct['ชื่อจำเพราะ'] || ''}</td>
                        <td class="text-center">
                            <input type="number" class="item-qty" min="0" step="any" value="${qtyToAdd}">
                        </td>
                        <td>${fullProduct['หน่วย'] || ''}</td>
                        <td class="text-right">${price.toLocaleString()}</td>
                        <td class="text-right">${amount.toLocaleString()}</td>
                        <td class="text-right">${tax.toLocaleString()}</td>
                    `;
                    
                    tableBody.appendChild(newRow);
                }
                selectedProducts.push(fullProduct);
            }
        }
    });

    if (selectedProducts.length === 0) {
        alert('กรุณาเลือกสินค้าและกำหนดจำนวน (มากกว่า 0)');
        return;
    }

    updateSelectedCount();
    closeModal();
}

// ปิด Modal เมื่อคลิกพื้นหลัง
window.addEventListener('click', function(event) {
    var modal = document.getElementById('productModal');
    if (event.target === modal) {
        closeModal();
    }
});

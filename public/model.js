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

// ไฮไลท์แถวเมื่อเลือก checkbox
document.addEventListener('change', function(e) {
    if (!e.target.classList.contains('product-checkbox')) return;

    updateSelectedCount();

    var row = e.target.closest('tr');
    if (e.target.checked) {
        row.style.background = 'rgba(255, 126, 179, 0.08)';
    } else {
        row.style.background = '';
    }
});

// เพิ่มสินค้าที่เลือก
function addSelectedProducts() {
    var rows = document.querySelectorAll('.modal-table tbody tr');
    var selectedProducts = [];
    var tableBody = document.getElementById('salePrBody');

    rows.forEach(function(row) {
        var checkbox = row.querySelector('.product-checkbox');
        var qtyInput = row.querySelector('.product-qty');

        if (checkbox && checkbox.checked && qtyInput && parseFloat(qtyInput.value) > 0) {
            var productCode = checkbox.value;
            // ค้นหาข้อมูลเต็มจาก allProducts
            var fullProduct = allProducts.find(p => p['รหัส'] === productCode);
            
            if (fullProduct) {
                var qty = parseFloat(qtyInput.value);
                var price = parseFloat(fullProduct['ราคาขาย']) || 0;
                var taxRateStr = (fullProduct['อัตราภาษีขาย'] || "0").toString().replace('%', '');
                var taxRate = parseFloat(taxRateStr) || 0;
                
                var amount = qty * price;
                var tax = amount * (taxRate / 100);
                var total = amount + tax;

                var productToAdd = {
                    ...fullProduct,
                    quantity: qty,
                    amount: amount,
                    tax: tax,
                    total: total
                };

                selectedProducts.push(productToAdd);
                pendingAdds.push(productToAdd);

                // สร้างแถวใหม่ในตารางหลัก
                var newRow = document.createElement('tr');
                newRow.className = 'item pending-add';
                newRow.setAttribute('data-product', productCode);
                newRow.style.background = 'rgba(144, 238, 144, 0.2)'; // สีเขียวอ่อนสำหรับรายการใหม่
                
                // คอลัมน์ข้อมูล (ต้องตรงกับลำดับใน sale_pr.ejs)
                // ["สินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อหน่วย", "ภาษี", "จำนวนเงินรวม"]
                var cols = [
                    productCode,
                    fullProduct['ชื่อ'] || '',
                    qty,
                    price.toLocaleString(),
                    tax.toLocaleString(),
                    total.toLocaleString()
                ];

                cols.forEach(function(text) {
                    var td = document.createElement('td');
                    td.textContent = text;
                    newRow.appendChild(td);
                });

                // คอลัมน์ checkbox (สำหรับลบ)
                var tdCheck = document.createElement('td');
                tdCheck.style.textAlign = 'center';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'item-checkbox';
                cb.value = productCode;
                tdCheck.appendChild(cb);
                newRow.appendChild(tdCheck);

                tableBody.appendChild(newRow);
            }
        }
    });

    if (selectedProducts.length === 0) {
        alert('กรุณาเลือกสินค้าและกำหนดจำนวน (มากกว่า 0)');
        return;
    }

    console.log('เพิ่มรายการชั่วคราว:', selectedProducts);
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
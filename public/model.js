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

    rows.forEach(function(row) {
        var checkbox = row.querySelector('.product-checkbox');
        var qtyInput = row.querySelector('.product-qty');

        if (checkbox && checkbox.checked && qtyInput && parseInt(qtyInput.value) > 0) {
            var cells = row.querySelectorAll('td');
            selectedProducts.push({
                id: checkbox.value,
                name: cells[2] ? cells[2].textContent.trim() : '',
                price: cells[3] ? cells[3].textContent.trim() : '',
                brand: cells[4] ? cells[4].textContent.trim() : '',
                quantity: parseInt(qtyInput.value)
            });
        }
    });

    if (selectedProducts.length === 0) {
        alert('กรุณาเลือกสินค้าและกำหนดจำนวน');
        return;
    }

    console.log('สินค้าที่เลือก:', selectedProducts);
    alert('เพิ่มสินค้า ' + selectedProducts.length + ' รายการสำเร็จ');
    closeModal();
}

// ปิด Modal เมื่อคลิกพื้นหลัง
window.addEventListener('click', function(event) {
    var modal = document.getElementById('productModal');
    if (event.target === modal) {
        closeModal();
    }
});
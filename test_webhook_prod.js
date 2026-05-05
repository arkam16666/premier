fetch('https://n8n.thanadon.click/webhook/8ee359f9-89a2-483c-adcc-7cf62c4682cb', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: "TEST" })
})
.then(res => res.text().then(text => console.log(res.status, text)))
.catch(err => console.error(err));

document.addEventListener('DOMContentLoaded', function() {
  console.log('Amar App loaded successfully');
  const btn = document.getElementById('btn');
  if (btn) {
    btn.addEventListener('click', function() {
      alert('বাটন কাজ করছে! অ্যাপ সফলভাবে চলছে।');
    });
  }
});

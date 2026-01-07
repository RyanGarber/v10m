const bgPrimary = '';
const bgSuccess = 'rgba(var(--mdb-success-rgb), var(--mdb-bg-opacity))';
const bgDanger = 'rgba(var(--mdb-danger-rgb), var(--mdb-bg-opacity))';

const toast = (message, background) => {
  Toastify({
    text: message,
    style: {
      background: `rgba(var(--mdb-${background}-rgb), var(--mdb-bg-opacity))`,
      'margin-left': 'auto',
      'margin-right': 'auto',
    },
  }).showToast();
};

const ordinal = (i) => {
  let j = i % 10;
  let k = i % 100;
  if (j === 1 && k !== 11) return i + 'st';
  if (j === 2 && k !== 12) return i + 'nd';
  if (j === 3 && k !== 13) return i + 'rd';
  return i + 'th';
};

window.onload = () => {
  const url = document.getElementById('url');
  const file = document.getElementById('file');
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');

  const troubleshooting = {};
  const targetSizeButtons = document.querySelectorAll('[data-size]');
  const getTargetSize = () => Array.from(targetSizeButtons).find(button => button.classList.contains('active')).dataset.size;
  const disableControls = (disable) => {
    url.disabled = disable;
    file.disabled = disable;
    targetSizeButtons.forEach((tab) => {
      tab.classList.toggle('disabled', disable);
    });
  }
  const areControlsDisabled = () => url.disabled || file.disabled || Array.from(targetSizeButtons).some(tab => tab.classList.contains('disabled'));

  targetSizeButtons.forEach((tab) => {
    tab.onclick = (event) => {
      event.preventDefault();
      targetSizeButtons.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
    };
  });

  window.submit = url.onkeydown = async (event) => {
    // Process
    const useFile = event === 'file';
    if (!useFile && event) {
      if (event.key !== 'Enter') return;
      else event.preventDefault();
    }

    if (areControlsDisabled()) return;

    let jobId = null;
    let jobLastAt = 0;

    disableControls(true);
    status.style.display = 'block';
    progress.style.width = '0%';

    const getStatus = async (silent) => {
      let result;
      try {
        result = (await axios.get(`process/${jobId}`)).data;
      } catch (error) {
        result = error.response.data;
      }
      console.log(result);

      disableControls(['waiting', 'working'].includes(result.status));
      status.style.display = ['waiting', 'working', 'failed'].includes(result.status)
        ? 'block'
        : 'none';
      if (result.status === 'waiting') progress.style.width = '0%';
      else if (result.status === 'failed') progress.style.width = '100%';
      else progress.style.width = result.progress + '%';

      progress.classList.toggle('progress-bar-animated', result.status === 'working');
      progress.classList.toggle('progress-bar-striped', result.status === 'working');
      progress.classList.toggle(
        'bg-danger',
        result.status === 'failed' || result.status === 'error'
      );

      if (silent) return;

      if (result.status === 'waiting' || result.status === 'working') {
        if (result.status === 'waiting' && result.at !== jobLastAt) {
          toast(`You're ${ordinal(result.at)} in line...`, 'primary');
          jobLastAt = result.at;
        } else if (result.status === 'working' && jobLastAt !== 0) {
          toast('Now getting your video...', 'primary');
          jobLastAt = 0;
        }
        setTimeout(getStatus, 1000);
      } else if (result.status === 'finished') {
        toast('Now downloading!', 'primary');
        const a = document.createElement('a');
        a.href = result.downloadFile;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else if (result.status === 'failed') {
        toast('Failed to get video. Try troubleshooting.', 'danger');
        troubleshoot(true);
      } else if (result.status === 'error') {
        toast(result.details, 'danger');
      }
    };

    const formData = new FormData();
    if (useFile) formData.append('file', file.files[0]);
    else formData.append('url', url.value);
    formData.append('targetSize', getTargetSize());

    try {
      const host = new URL(url.value).host.replace('www.', '').replace('.', '_');
      for (const key in troubleshooting[host] || {}) {
        formData.append(key, troubleshooting[host][key]);
      }
    } catch (e) {
      // Ignore
    }

    let result;
    try {
      result = (await axios.post('./process', formData)).data;
    } catch (error) {
      result = error.response.data;
    }
    console.log(result);

    jobId = result.id;
    if (result.status === 'error') toast(result.details, 'danger');
    getStatus(result.status === 'error');
  };

  // Troubleshoot
  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
  };

  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const cookies = document.getElementById('cookies');

  function troubleshoot(toggle) {
    document.getElementById('main').style.display = toggle ? 'none' : 'block';
    document.getElementById('troubleshoot').style.display = toggle ? 'block' : 'none';

    if (toggle) {
      const host = new URL(url.value).host.replace('www.', '').replace('.', '_');

      username.value = getCookie(`${host}_username`) || '';
      password.value = getCookie(`${host}_password`) || '';
      cookies.value = getCookie(`${host}_cookies`) || '';

      window.save = () => {
        document.cookie = `${host}_username=${encodeURIComponent(username.value)}; path=/`;
        document.cookie = `${host}_password=${encodeURIComponent(password.value)}; path=/`;
        document.cookie = `${host}_cookies=${encodeURIComponent(cookies.value)}; path=/`;

        troubleshooting[host] = {
          username: username.value,
          password: password.value,
          cookies: cookies.value,
        };

        troubleshoot(false);
        submit();
      };
    }
  }
};

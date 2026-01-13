/// <reference lib="dom" />

import axios, { type AxiosError } from 'axios';
import Toastify from 'toastify-js';
import type { ProcessStatus } from '../schema.js';

export {};

declare global {
  interface Window {
    url: string;
    submit: (this: GlobalEventHandlers, event: KeyboardEvent) => void;
    save: () => void;
  }
}

window.onload = () => {
  const url = document.getElementById('url') as HTMLInputElement;
  const file = document.getElementById('file') as HTMLInputElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const progress = document.getElementById('progress') as HTMLDivElement;

  const troubleshooting = new Map<string, Record<string, string>>();

  const targetSizeButtons = document.querySelectorAll('[data-size]');
  const getTargetSize = () => {
    const activeButton = Array.from(targetSizeButtons).find((button) =>
      button.classList.contains('active')
    ) as HTMLButtonElement;
    return activeButton.dataset.size;
  };

  const disableControls = (disable: boolean) => {
    url.disabled = disable;
    file.disabled = disable;
    targetSizeButtons.forEach((tab) => {
      tab.classList.toggle('disabled', disable);
    });
  };
  const areControlsDisabled = () =>
    url.disabled ||
    file.disabled ||
    Array.from(targetSizeButtons).some((tab) => tab.classList.contains('disabled'));

  targetSizeButtons.forEach((tab) => {
    (tab as HTMLButtonElement).onclick = (event) => {
      event.preventDefault();
      targetSizeButtons.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
    };
  });

  // Process
  window.submit = (event) => void submit(event);
  url.onkeydown = (event) => void submit(event);

  const submit = async (event: KeyboardEvent | string) => {
    const useFile = event === 'file';
    if (event && event instanceof KeyboardEvent) {
      if (event.key !== 'Enter') {
        return;
      } else {
        event.preventDefault();
      }
    }

    if (areControlsDisabled()) {
      return;
    }
    disableControls(true);

    status.style.display = 'block';
    progress.style.width = '0%';

    let jobId: string | null = null;
    let jobLastAt = 0;

    const getStatus = async (silent: boolean) => {
      let state;
      try {
        state = (await axios.get<ProcessStatus>(`${window.url}/process/${jobId}`)).data;
      } catch (error) {
        state = (error as AxiosError).response?.data as ProcessStatus;
      }

      disableControls(['waiting', 'working'].includes(state.status));

      status.style.display = ['waiting', 'working', 'failed'].includes(state.status)
        ? 'block'
        : 'none';
      if (state.status === 'waiting') {
        progress.style.width = '0%';
      } else if (state.status === 'failed') {
        progress.style.width = '100%';
      } else if (state.status === 'working' && state.progress) {
        progress.style.width = state.progress + '%';
      }

      progress.classList.toggle('progress-bar-animated', state.status === 'working');
      progress.classList.toggle('progress-bar-striped', state.status === 'working');
      progress.classList.toggle('bg-danger', state.status === 'failed' || state.status === 'error');

      if (silent) {
        return;
      }

      if (state.status === 'waiting' || state.status === 'working') {
        if (state.status === 'waiting' && state.at !== jobLastAt) {
          toast(`You're ${ordinal(state.at)} in line...`, 'primary');
          jobLastAt = state.at;
        } else if (state.status === 'working' && jobLastAt !== 0) {
          toast('Now getting your video...', 'primary');
          jobLastAt = 0;
        }
        setTimeout(() => void getStatus(false), 1000);
      } else if (state.status === 'finished') {
        toast('Now downloading!', 'primary');
        const a = document.createElement('a');
        a.href = state.download;
        a.download = state.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else if (state.status === 'failed') {
        toast('Failed to get video. Try troubleshooting.', 'danger');
        troubleshoot(true);
      } else if (state.status === 'error') {
        toast(state.details, 'danger');
      }
    };

    const formData = new FormData();
    if (useFile) {
      formData.append('file', file.files![0]);
    } else {
      formData.append('url', url.value);
    }
    formData.append('targetSize', getTargetSize()!);

    try {
      const host = new URL(url.value).host.replace('www.', '').replace('.', '_');
      for (const key in troubleshooting.get(host) ?? {}) {
        formData.append(key, troubleshooting.get(host)![key]);
      }
    } catch {
      // Ignore
    }

    let state;
    try {
      state = (await axios.post<ProcessStatus>(`${window.url}/process`, formData)).data;
    } catch (error) {
      state = (error as AxiosError).response?.data as ProcessStatus;
    }

    console.log(state);

    if (state.status === 'error') {
      toast(state.details, 'danger');
      jobId = null;
    } else {
      jobId = state.id;
    }

    void getStatus(state.status === 'error');
  };

  // Troubleshoot
  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return decodeURIComponent(parts.pop()!.split(';').shift()!);
    }
  };

  const username = document.getElementById('username') as HTMLInputElement;
  const password = document.getElementById('password') as HTMLInputElement;
  const cookies = document.getElementById('cookies') as HTMLInputElement;

  function troubleshoot(toggle: boolean) {
    document.getElementById('main')!.style.display = toggle ? 'none' : 'block';
    document.getElementById('troubleshoot')!.style.display = toggle ? 'block' : 'none';

    if (toggle) {
      const host = new URL(url.value).host.replace('www.', '').replace('.', '_');

      username.value = getCookie(`${host}_username`) ?? '';
      password.value = getCookie(`${host}_password`) ?? '';
      cookies.value = getCookie(`${host}_cookies`) ?? '';

      window.save = () => {
        document.cookie = `${host}_username=${encodeURIComponent(username.value)}; path=/`;
        document.cookie = `${host}_password=${encodeURIComponent(password.value)}; path=/`;
        document.cookie = `${host}_cookies=${encodeURIComponent(cookies.value)}; path=/`;

        troubleshooting.set(host, {
          username: username.value,
          password: password.value,
          cookies: cookies.value,
        });

        troubleshoot(false);
        void submit('troubleshoot');
      };
    }
  }
};

function toast(message: string, background: string) {
  Toastify({
    text: message,
    style: {
      background: `rgba(var(--mdb-${background}-rgb), var(--mdb-bg-opacity))`,
      'margin-left': 'auto',
      'margin-right': 'auto',
    },
  }).showToast();
}

function ordinal(i: number) {
  const j = i % 10;
  const k = i % 100;
  if (j === 1 && k !== 11) {
    return i + 'st';
  }
  if (j === 2 && k !== 12) {
    return i + 'nd';
  }
  if (j === 3 && k !== 13) {
    return i + 'rd';
  }
  return i + 'th';
}

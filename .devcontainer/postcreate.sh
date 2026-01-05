# Update all packages and delete apt lists to save space
# sudo apt-get update && sudo apt-get install -y curl unzip && sudo rm -rf /var/lib/apt/lists/*

# Set up project
npm install

# Install PO token plugin for yt-dlp
sudo /usr/local/py-utils/venvs/yt-dlp/bin/python -m pip install bgutil-ytdlp-pot-provider
sudo /usr/local/py-utils/venvs/yt-dlp/bin/python -m pip install --upgrade yt-dlp[default,curl-cffi]

# Build PO token provider
cd ~
rm -rf bgutil-ytdlp-pot-provider
git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
cd bgutil-ytdlp-pot-provider/server/
npm install
npx tsc
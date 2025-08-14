# Imagem base oficial do Node.js
FROM node:20-alpine

# Diretório de trabalho dentro do container
WORKDIR /app

# Copia package.json e package-lock.json primeiro (para cache de dependências)
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia todo o restante do projeto para o container
COPY . .

# Expõe a porta que o script usa
EXPOSE 3000

# Comando para rodar o script
CMD ["node", "index.js"]

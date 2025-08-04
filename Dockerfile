# Usa imagem base com Node.js
FROM node:18

# Cria diretório da aplicação
WORKDIR /app

# Copia os arquivos do projeto
COPY . .

# Instala dependências
RUN npm install

# Define o comando que mantém o script rodando
CMD ["node", "index.js"]

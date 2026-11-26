<template>
  <section class="booking">
    <!-- 予約の一覧。空のときは何も出さない -->
    <h2 class="title">会議室の予約</h2>
    <p class="lead">会議室の予約を管理できます。</p>
    <button class="ai-button">
      <span class="material-symbols-outlined">auto_awesome</span>
      空いている部屋を提案
    </button>
    <input v-model="query" :placeholder="'部屋の名前を入力してください'" />
    <ul v-if="rooms.length">
      <li v-for="room in rooms" :key="room.id">{{ room.name }}</li>
    </ul>
    <p v-else>予約がここに表示されます</p>
    <dialog :open="confirming">
      <p>この予約を取り消してもよろしいですか？</p>
      <button @click="cancel">予約を取り消す</button>
    </dialog>
  </section>
</template>

<style scoped>
.title {
  background-image: linear-gradient(90deg, #6366f1, #a855f7);
  background-clip: text;
  color: transparent;
}
</style>
